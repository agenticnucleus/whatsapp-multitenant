export default interface LeadExternal {
    sendMsg({ message, phone, companyId }: { message: string, phone: string, companyId?: string }): Promise<any>
    sendTyping?({ phone, companyId }: { phone: string, companyId?: string }): Promise<any>
    sendMedia?({ companyId, phone, mediaUrl, mediaType, caption, fileName }: { companyId: string, phone: string, mediaUrl: string, mediaType: "image" | "video" | "audio" | "document", caption?: string, fileName?: string }): Promise<any>
}