export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    service: "shaughv-health-mcp",
    status: "ok",
    time: new Date().toISOString(),
  });
}
