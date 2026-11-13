/** Platform per-transfer ceiling in USD. Applies to every user; a Guard limit can only lower it. */
export const platformCeilingUsd = () => process.env.SPAK_MAX_EXECUTION_USD ?? "1000";
