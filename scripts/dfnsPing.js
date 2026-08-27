import * as dotenv from "dotenv";
dotenv.config();
const baseUrl = "https://api.dfns.io";
const token = process.env.DFNS_AUTH_TOKEN;

if (!token) {
  console.error("Missing DFNS_AUTH_TOKEN env var.");
  process.exit(1);
}

async function main() {
  const res = await fetch(`${baseUrl}/wallets`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    limit: 1,
  });

  if (!res.ok) {
    console.error(`Dfns ping FAILED: HTTP ${res.status} ${res.statusText}`);
    console.error(await res.text());
    process.exit(1);
  }

  const body = await res.json();
  console.log("Dfns connection OK");
  console.log(body);
}

main().catch((err) => {
  console.error("Dfns ping FAILED:", err);
  process.exit(1);
})
