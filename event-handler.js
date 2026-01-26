// event-handler.js

const state = require('./state');
const { SIGNATURE } = require('./config');
const { logError } = require('./utils');

/**
 * @description يعالج حدث انضمام عضو جديد إلى المجموعة.
 * @param {GroupNotification} notification - إشعار الانضمام.
 * @param {Client} client - عميل واتساب.
 */
async function handleGroupJoin(notification, client) {
    try {
        const groupId = notification.chatId;
        // الحصول على اسم العضو الجديد
        const contact = await client.getContactById(notification.recipientIds[0]);
        const userName = contact.pushname || contact.name || "العضو الجديد";
        const groupName = state.groupsMetadata.get(groupId) || "المجموعة";

        // رسالة ترحيب ذكية
        const welcomeMessage = `
👋 أهلاً بك يا ${userName} في مجموعة *${groupName}*!

نتمنى لك وقتاً ممتعاً ومفيداً معنا. ✨

${SIGNATURE}
        `;
        
        await client.sendMessage(groupId, welcomeMessage);
        console.log(`[+] Welcomed new member ${userName} to group ${groupName}.`);

    } catch (error) {
        logError(error, 'handleGroupJoin');
    }
}

/**
 * @description يعالج حدث مغادرة عضو للمجموعة.
 * @param {GroupNotification} notification - إشعار المغادرة.
 * @param {Client} client - عميل واتساب.
 */
async function handleGroupLeave(notification, client) {
    try {
        const groupId = notification.chatId;
        const contact = await client.getContactById(notification.recipientIds[0]);
        const userName = contact.pushname || contact.name;

        console.log(`[-] Member ${userName} left group ${state.groupsMetadata.get(groupId)}.`);
        
        // يمكن إضافة منطق هنا لإرسال رسالة وداع للمشرفين أو تسجيل الحدث
        // await client.sendMessage(config.OWNER_ID, ` FYI: ${userName} left ${state.groupsMetadata.get(groupId)}.`);

    } catch (error) {
        logError(error, 'handleGroupLeave');
    }
}

module.exports = {
    handleGroupJoin,
    handleGroupLeave,
};