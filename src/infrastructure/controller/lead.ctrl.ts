import { Request, Response } from "express";
import { LeadCreate } from "../../application/lead.create";

class LeadCtrl {
  constructor(private readonly leadCreator: LeadCreate) { }

  public sendCtrl = async ({ body }: Request, res: Response) => {
    try {
      const { message, phone, companyId } = body;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      if (!message || !phone) {
        return res.status(400).json({ error: "message and phone are required" });
      }

      const response = await this.leadCreator.sendMessageAndSave({ message, phone, companyId });
      res.json(response);
    } catch (error: any) {
      console.error("Send message error:", error);
      res.status(500).json({ error: error.message || "Failed to send message" });
    }
  };

  public sendTypingCtrl = async ({ body }: Request, res: Response) => {
    try {
      const { phone, companyId } = body;
      if (!companyId || !phone) return res.status(400).json({ error: "missing data" });

      await this.leadCreator.sendTyping({ phone, companyId });
      res.json({ status: "ok" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  };
}

export default LeadCtrl;

