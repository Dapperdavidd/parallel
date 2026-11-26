/**
 * Liveness: is this process answering at all?
 *
 * Deliberately shallow. It touches no database and no RPC, so it stays fast
 * and cannot be made to fail by something downstream — which is what a process
 * supervisor needs to know, and nothing more. Readiness is `/api/ready`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

export function GET(): Response {
  return Response.json(
    {
      ok: true,
      service: "parallel-web",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      at: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
