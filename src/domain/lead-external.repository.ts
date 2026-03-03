export default interface LeadExternal {
    sendMsg({ message, phone, companyId }: { message: string, phone: string, companyId?: string }): Promise<any>
    sendTyping?({ phone, companyId }: { phone: string, companyId?: string }): Promise<any>
}