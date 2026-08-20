import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { productMapErrorResponse } from "@/lib/product-map/http";
import { listProductMapSkills } from "@/lib/product-map/service";

export async function GET(request: Request) {
  try {
    await requireApiPrincipal(request.headers);
    return jsonResponse({ skills: await listProductMapSkills() });
  } catch (error) { return productMapErrorResponse(error); }
}
