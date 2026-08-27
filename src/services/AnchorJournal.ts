import {
    mkdir,
    open,
    readFile,
    rename,
    unlink,
    type FileHandle,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { JournalRecord } from "../worker/types.js";

interface JournalFile {
    version: 1;
    records: Record<string, JournalRecord>;
}

interface JournalLock {
    version: 1;
    token: string;
    hostname: string;
    pid: number;
    started_at: string;
}

export class AnchorJournal {
    private readonly filePath: string;
    private readonly lockPath: string;
    private records = new Map<string, JournalRecord>();
    private lockHandle: FileHandle | undefined;
    private lockToken: string | undefined;

    constructor(filePath: string) {
        this.filePath = path.resolve(filePath);
        this.lockPath = `${this.filePath}.lock`;
    }

    async acquireOwnership(): Promise<void> {
        if (this.lockHandle) throw new Error("Anchor journal ownership is already held");
        await mkdir(path.dirname(this.filePath), { recursive: true });

        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                await this.createOwnershipLock();
                return;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
                if (attempt === 0 && (await this.removeStaleSameHostLock())) continue;
                throw new Error(
                    `Anchor journal is already owned by another live or unverifiable process: ${this.lockPath}`,
                );
            }
        }
        throw new Error(`Cannot acquire anchor journal ownership: ${this.lockPath}`);
    }

    async releaseOwnership(): Promise<void> {
        const handle = this.lockHandle;
        const token = this.lockToken;
        if (!handle || !token) return;
        this.lockHandle = undefined;
        this.lockToken = undefined;

        let ownsCurrentLock = false;
        try {
            const parsed = JSON.parse(await readFile(this.lockPath, "utf8")) as Partial<JournalLock>;
            ownsCurrentLock = parsed.token === token;
        } finally {
            await handle.close();
        }
        if (ownsCurrentLock) await unlink(this.lockPath);
    }

    async load(): Promise<void> {
        this.assertOwned();
        try {
            const raw = await readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw) as Partial<JournalFile>;
            if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object") {
                throw new Error("unsupported journal structure");
            }
            this.records = new Map(Object.entries(parsed.records));
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "ENOENT") return;
            throw new Error(`Cannot load anchor journal: ${error instanceof Error ? error.message : "unknown error"}`);
        }
    }

    get(memo: string): JournalRecord | undefined {
        return this.records.get(memo);
    }

    entries(): JournalRecord[] {
        return Array.from(this.records.values(), (record) => ({ ...record }));
    }

    async set(record: JournalRecord): Promise<void> {
        this.assertOwned();
        this.records.set(record.memo, record);
        await this.persist();
    }

    async delete(memo: string): Promise<boolean> {
        this.assertOwned();
        if (!this.records.delete(memo)) return false;
        await this.persist();
        return true;
    }

    private async persist(): Promise<void> {
        const directory = path.dirname(this.filePath);
        await mkdir(directory, { recursive: true });
        const temporary = `${this.filePath}.${process.pid}.tmp`;
        const data: JournalFile = {
            version: 1,
            records: Object.fromEntries(this.records),
        };
        let temporaryHandle: FileHandle | undefined;
        try {
            temporaryHandle = await open(temporary, "w", 0o600);
            if (process.platform !== "win32") await temporaryHandle.chmod(0o600);
            await temporaryHandle.writeFile(`${JSON.stringify(data)}\n`, "utf8");
            // The transaction is broadcast only after set() resolves. Syncing
            // the exact bytes before the atomic rename makes the journal a
            // durable precondition rather than a page-cache-only promise.
            await temporaryHandle.sync();
            await temporaryHandle.close();
            temporaryHandle = undefined;
            await rename(temporary, this.filePath);
            await this.syncDirectoryBestEffort(directory);
        } finally {
            await temporaryHandle?.close().catch(() => undefined);
        }
    }

    private async createOwnershipLock(): Promise<void> {
        let handle: FileHandle | undefined;
        try {
            handle = await open(this.lockPath, "wx", 0o600);
            const token = randomUUID();
            const lock: JournalLock = {
                version: 1,
                token,
                hostname: os.hostname(),
                pid: process.pid,
                started_at: new Date().toISOString(),
            };
            await handle.writeFile(`${JSON.stringify(lock)}\n`, "utf8");
            await handle.sync();
            this.lockHandle = handle;
            this.lockToken = token;
        } catch (error) {
            if (handle) {
                await handle.close().catch(() => undefined);
                await unlink(this.lockPath).catch(() => undefined);
            }
            throw error;
        }
    }

    private async removeStaleSameHostLock(): Promise<boolean> {
        let raw: string;
        try {
            raw = await readFile(this.lockPath, "utf8");
        } catch (error) {
            return (error as NodeJS.ErrnoException).code === "ENOENT";
        }

        let lock: Partial<JournalLock>;
        try {
            lock = JSON.parse(raw) as Partial<JournalLock>;
        } catch {
            return false;
        }
        if (
            lock.version !== 1 ||
            typeof lock.token !== "string" ||
            lock.hostname !== os.hostname() ||
            !Number.isSafeInteger(lock.pid) ||
            Number(lock.pid) <= 0 ||
            this.isProcessAlive(Number(lock.pid))
        ) {
            return false;
        }

        try {
            if ((await readFile(this.lockPath, "utf8")) !== raw) return false;
            await unlink(this.lockPath);
            return true;
        } catch {
            return false;
        }
    }

    private isProcessAlive(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch (error) {
            return (error as NodeJS.ErrnoException).code !== "ESRCH";
        }
    }

    private assertOwned(): void {
        if (!this.lockHandle || !this.lockToken) {
            throw new Error("Anchor journal ownership must be acquired before use");
        }
    }

    private async syncDirectoryBestEffort(directory: string): Promise<void> {
        let directoryHandle: FileHandle | undefined;
        try {
            directoryHandle = await open(directory, "r");
            await directoryHandle.sync();
        } catch (error) {
            const unsupported = new Set(["EACCES", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EPERM"]);
            if (!unsupported.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
        } finally {
            await directoryHandle?.close().catch(() => undefined);
        }
    }
}
