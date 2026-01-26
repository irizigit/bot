// utils.js

const state = require('./state');
const { OWNER_ID } = require('./config');

/**
 * @description يتحقق مما إذا كان المستخدم مالكًا للبوت.
 * @param {string} userId - معرف المستخدم.
 * @returns {boolean} - true إذا كان المستخدم مالكًا.
 */
function isOwner(userId) {
    return userId === OWNER_ID;
}

/**
 * @description يتحقق مما إذا كان المستخدم مطورًا.
 * @param {string} userId - معرف المستخدم.
 * @returns {boolean} - true إذا كان المستخدم مطورًا.
 */
function isDeveloper(userId) {
    return state.admins.has(userId) || isOwner(userId);
}

/**
 * @description يتحقق مما إذا كان المستخدم مشرفًا في المجموعة.
 * @param {Client} client - عميل واتساب.
 * @param {string} userId - معرف المستخدم.
 * @param {string} groupId - معرف المجموعة.
 * @returns {Promise<boolean>} - true إذا كان المستخدم مشرفًا.
 */
async function isAdmin(client, userId, groupId) {
    try {
        // التحقق أولاً إذا كان المستخدم مالكًا أو مطورًا
        if (isOwner(userId) || isDeveloper(userId)) {
            return true;
        }

        // التحقق من صلاحيات المشرف في المجموعة
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) {
            return false;
        }

        const participants = await chat.participants;
        const participant = participants.find(p => p.id._serialized === userId);
        
        return participant && (participant.isAdmin || participant.isSuperAdmin);
    } catch (error) {
        console.error('[❌] Error checking admin status:', error);
        return false;
    }
}

/**
 * @description يسجل الخطأ في وحدة التحكم.
 * @param {Error} error - كائن الخطأ.
 * @param {string} context - سياق حدوث الخطأ.
 */
function logError(error, context = '') {
    console.error(`[❌] Error in ${context}:`, error);
}

/**
 * @description يتحقق مما إذا كان المستخدم لديه صلاحية تنفيذ الأمر.
 * @param {Client} client - عميل واتساب.
 * @param {string} userId - معرف المستخدم.
 * @param {string} groupId - معرف المجموعة.
 * @param {string} permissionType - نوع الصلاحية (owner, developer, admin).
 * @returns {Promise<boolean>} - true إذا كان المستخدم لديه الصلاحية.
 */
async function hasPermission(client, userId, groupId, permissionType = 'admin') {
    try {
        switch (permissionType) {
            case 'owner':
                return isOwner(userId);
            case 'developer':
                return isDeveloper(userId);
            case 'admin':
            default:
                return await isAdmin(client, userId, groupId);
        }
    } catch (error) {
        console.error('[❌] Error checking permissions:', error);
        return false;
    }
}

/**
 * @description يرسل رسالة خطأ للمستخدم.
 * @param {Message} message - كائن الرسالة.
 * @param {string} errorMessage - رسالة الخطأ.
 * @param {string} context - سياق الخطأ.
 */
async function sendErrorMessage(message, errorMessage, context = '') {
    try {
        const { SIGNATURE } = require('./config');
        await message.reply(`⚠️ ${errorMessage}${SIGNATURE}`);
        logError(new Error(errorMessage), context);
    } catch (error) {
        console.error('[❌] Error sending error message:', error);
    }
}

/**
 * @description يتحقق من صلاحية المستخدم ويرسل رسالة خطأ إذا لم يكن لديه الصلاحية.
 * @param {Message} message - كائن الرسالة.
 * @param {Client} client - عميل واتساب.
 * @param {string} permissionType - نوع الصلاحية (owner, developer, admin).
 * @returns {Promise<boolean>} - true إذا كان المستخدم لديه الصلاحية.
 */
async function checkPermission(message, client, permissionType = 'admin') {
    try {
        const chat = await message.getChat();
        const contact = await message.getContact();
        const userId = contact.id._serialized;
        const groupId = chat.id._serialized;

        const hasAccess = await hasPermission(client, userId, groupId, permissionType);
        
        if (!hasAccess) {
            const { SIGNATURE } = require('./config');
            let permissionText = '';
            
            switch (permissionType) {
                case 'owner':
                    permissionText = 'للمالك فقط';
                    break;
                case 'developer':
                    permissionText = 'للمطورين فقط';
                    break;
                case 'admin':
                default:
                    permissionText = 'للمشرفين فقط';
                    break;
            }
            
            await message.reply(`⚠️ هذا الأمر متاح ${permissionText}!${SIGNATURE}`);
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('[❌] Error in checkPermission:', error);
        return false;
    }
}

/**
 * @description يتحقق مما إذا كانت الرسالة من مجموعة.
 * @param {Message} message - كائن الرسالة.
 * @returns {Promise<boolean>} - true إذا كانت الرسالة من مجموعة.
 */
async function isGroupMessage(message) {
    try {
        const chat = await message.getChat();
        return chat.isGroup;
    } catch (error) {
        console.error('[❌] Error checking if message is from group:', error);
        return false;
    }
}

/**
 * @description يرسل رسالة للمستخدم إذا لم تكن الرسالة من مجموعة.
 * @param {Message} message - كائن الرسالة.
 * @returns {Promise<boolean>} - true إذا كانت الرسالة من مجموعة.
 */
async function requireGroup(message) {
    try {
        const isGroup = await isGroupMessage(message);
        
        if (!isGroup) {
            const { SIGNATURE } = require('./config');
            await message.reply(`⚠️ هذا الأمر يعمل في المجموعات فقط!${SIGNATURE}`);
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('[❌] Error in requireGroup:', error);
        return false;
    }
}

module.exports = {
    isOwner,
    isDeveloper,
    isAdmin,
    logError,
    hasPermission,
    sendErrorMessage,
    checkPermission,
    isGroupMessage,
    requireGroup
};