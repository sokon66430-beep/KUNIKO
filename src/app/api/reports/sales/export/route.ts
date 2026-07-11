import { sendReport } from "@/lib/reportExport";

export const dynamic = "force-dynamic";

// xlsx | csv | pdf — pick via ?format=
export const GET = (req: Request) => sendReport(req, "sales");
