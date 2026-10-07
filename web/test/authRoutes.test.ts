import {it,expect} from "vitest";
import {isProtectedRoute,isAuthOnlyPublicRoute} from "../src/lib/auth-routes";
it("does not require login or redirect authenticated visitors on Verify",()=>{expect(isProtectedRoute("/verify")).toBe(false);expect(isAuthOnlyPublicRoute("/verify")).toBe(false);});
