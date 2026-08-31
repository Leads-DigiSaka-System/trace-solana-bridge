export function routeParam(value: string | string[] | undefined): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}
