// state.js

const { OWNER_ID } = require('./config');

module.exports = {
    // حالة البوت العامة
    isBotReady: false,
    isRestarting: false,
    
    // معرف المالك
    OWNER_ID: OWNER_ID,
    
    // المشرفين والمطورين
    admins: new Set(),
    
    // بيانات النظام
    groupsMetadata: new Map(),
    userState: new Map(),
    
    // بيانات المقررات الدراسية
    sections: new Map(),
    classes: new Map(),
    subjects: new Map(),
    groupsData: new Map(),
    professors: new Map(),
    
    // بيانات المحاضرات
    lectures: new Map(),
    
    // إحصائيات البوت
    stats: {
        messagesProcessed: 0,
        commandsExecuted: 0,
        errors: 0,
        startTime: Date.now()
    }
};