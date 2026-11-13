import { z } from "zod";
export const agentIdParam = (id: string) => z.string().regex(/^agt_[0-9a-f]{24}$/, "invalid id").parse(id);
