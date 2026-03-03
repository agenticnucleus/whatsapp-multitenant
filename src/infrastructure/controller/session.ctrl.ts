import { Request, Response } from "express";
import { BaileysTransporter } from "../repositories/baileys.repository";

class SessionCtrl {
    constructor(private readonly transporter: BaileysTransporter) { }

    /**
     * POST /session/init
     * Body: { companyId: string }
     * Initialize a new WhatsApp session for a company.
     */
    public initSession = async (req: Request, res: Response) => {
        try {
            const { companyId } = req.body;

            if (!companyId) {
                return res.status(400).json({ error: "companyId is required" });
            }

            const result = await this.transporter.startSession(companyId);
            res.json(result);
        } catch (error: any) {
            console.error("Init session error:", error);
            res.status(500).json({ error: error.message || "Failed to init session" });
        }
    };

    /**
     * GET /session/qr/:companyId
     * Returns the QR code as SVG for the specified company.
     */
    public getQr = async (req: Request, res: Response) => {
        try {
            const { companyId } = req.params;

            if (!companyId) {
                return res.status(400).json({ error: "companyId is required" });
            }

            const qrSvg = this.transporter.getQr(companyId);

            if (!qrSvg) {
                // Check if session is connected (no QR needed)
                const status = this.transporter.getStatus(companyId);
                if (status.connected) {
                    return res.json({ status: "connected", message: "Session already connected, no QR needed" });
                }
                return res.status(404).json({ error: "QR not available. Session may not be initialized or already connected." });
            }

            res.setHeader("Content-Type", "image/svg+xml");
            res.send(qrSvg);
        } catch (error: any) {
            console.error("Get QR error:", error);
            res.status(500).json({ error: error.message || "Failed to get QR" });
        }
    };

    /**
     * GET /session/status/:companyId
     * Returns the session status for the specified company.
     * Auto-restores session from MySQL if credentials exist but session is not in memory.
     */
    public getStatus = async (req: Request, res: Response) => {
        try {
            const { companyId } = req.params;

            if (!companyId) {
                return res.status(400).json({ error: "companyId is required" });
            }

            // Try to auto-restore session if not in memory
            const status = await this.transporter.getStatusWithAutoRestore(companyId);
            res.json({ companyId, ...status });
        } catch (error: any) {
            console.error("Get status error:", error);
            res.status(500).json({ error: error.message || "Failed to get status" });
        }
    };

    /**
     * POST /session/logout
     * Body: { companyId: string }
     * Logout and disconnect a WhatsApp session.
     */
    public logout = async (req: Request, res: Response) => {
        try {
            const { companyId } = req.body;

            if (!companyId) {
                return res.status(400).json({ error: "companyId is required" });
            }

            const result = await this.transporter.logout(companyId);
            res.json(result);
        } catch (error: any) {
            console.error("Logout error:", error);
            res.status(500).json({ error: error.message || "Failed to logout" });
        }
    };

    /**
     * GET /session/list
     * Returns all active sessions and their status.
     */
    public listSessions = async (_req: Request, res: Response) => {
        try {
            const sessions = this.transporter.getAllSessions();
            res.json({ sessions });
        } catch (error: any) {
            console.error("List sessions error:", error);
            res.status(500).json({ error: error.message || "Failed to list sessions" });
        }
    };
}

export default SessionCtrl;
