import { describe, expect, it } from "@jest/globals";
import { routeParam } from "../src/controllers/routeParam.js";

describe("routeParam", () => {
    it("accepts one non-empty route segment", () => {
        expect(routeParam("123")).toBe("123");
    });

    it("rejects absent, empty, or multi-valued parameters", () => {
        expect(routeParam(undefined)).toBeNull();
        expect(routeParam("")).toBeNull();
        expect(routeParam(["123", "456"])).toBeNull();
    });
});
