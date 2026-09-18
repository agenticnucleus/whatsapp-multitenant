import LeadExternal from "../domain/lead-external.repository";
import LeadRepository from "../domain/lead.repository";

export class LeadCreate {
  private leadRepository: LeadRepository;
  private leadExternal: LeadExternal;
  constructor(respositories: [LeadRepository, LeadExternal]) {
    const [leadRepository, leadExternal] = respositories;
    this.leadRepository = leadRepository;
    this.leadExternal = leadExternal;
  }

  public async sendMessageAndSave({
    message,
    phone,
    companyId,
  }: {
    message: string;
    phone: string;
    companyId: string;
  }) {
    const responseDbSave = await this.leadRepository.save({ message, phone });
    const responseExSave = await this.leadExternal.sendMsg({ message, phone, companyId });
    return { responseDbSave, responseExSave };
  }

  public async sendTyping({ phone, companyId }: { phone: string; companyId: string }) {
    if (this.leadExternal.sendTyping) {
      return await this.leadExternal.sendTyping({ phone, companyId });
    }
    return { status: "not_supported" };
  }

  public async sendMedia(data: { companyId: string; phone: string; mediaUrl: string; mediaType: "image" | "video" | "audio" | "document"; caption?: string; fileName?: string }) {
    if (this.leadExternal.sendMedia) {
      return await this.leadExternal.sendMedia(data);
    }
    return { status: "not_supported" };
  }
}
