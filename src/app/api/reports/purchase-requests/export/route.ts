import { sendReport } from "@/lib/reportExport";

export const dynamic = "force-dynamic";

// xlsx (ON Mart styled) | csv | pdf — pick via ?format=
export const GET = (req: Request) => sendReport(req, "purchase-requests");
