// state-handler.js - الإصدار النهائي والمكتمل

const state = require('./state.js');
const { SIGNATURE, USER_STATE_TIMEOUT } = require('./config.js');

// --- استيراد دوال معالجة الأوامر من ملفاتها الخاصة ---
const setupHandlers = require('./commands/setup-handler.js');
const addLectureHandlers = require('./commands/add-lecture-commands.js');
const downloadHandlers = require('./commands/download-commands.js');
const courseManagementHandlers = require('./commands/course-management.js');

/**
 * @description الموجه الرئيسي للحالات (State Router) الذي يحتوي على كل الخطوات الممكنة.
 */
const allSteps = {
    // --- خطوات عملية الإعداد الكاملة (!إعداد) ---
    'setup_select_action': setupHandlers.handleSetupSelectAction,
    'setup_get_section_name': setupHandlers.handleSetupGetSectionName,
    'setup_get_class_name': setupHandlers.handleSetupGetClassName,
    'setup_get_subjects_for_class': setupHandlers.handleSetupGetSubjects,
    'setup_get_groups_and_profs': setupHandlers.handleSetupGetGroupsAndProfs,
    'setup_ask_for_another_class': setupHandlers.handleAskForAnotherClass,
    'setup_confirm_and_save': setupHandlers.handleSetupConfirmAndSave,

    // --- خطوات عملية إضافة محاضرة (!اضافة_محاضرة) ---
    'add_lecture_select_section': addLectureHandlers.handleSelectSection,
    'add_lecture_select_class': addLectureHandlers.handleSelectClass,
    'add_lecture_select_subject': addLectureHandlers.handleSelectSubject,
    'add_lecture_select_group': addLectureHandlers.handleSelectGroup,
    'add_lecture_select_professor': addLectureHandlers.handleSelectProfessor,
    'add_lecture_get_details': addLectureHandlers.handleGetLectureDetails,
    'add_lecture_upload_file': addLectureHandlers.handleUploadFile,

    // --- خطوات عملية عرض وتحميل المحاضرات (!عرض_المحاضرات) ---
    'view_lectures_select_section': downloadHandlers.handleViewLecturesSelectSection,
    'view_lectures_select_class': downloadHandlers.handleViewLecturesSelectClass,
    'view_lectures_request_lecture': downloadHandlers.handleRequestLecture,
    'view_lectures_download': downloadHandlers.handleDownloadLecture,

    // --- خطوات عملية إدارة المقررات (!إدارة_المقررات) ---
    'select_management_type': courseManagementHandlers.handleSelectManagementType,
    'sections_action': courseManagementHandlers.handleSectionsAction,
    'select_section_for_classes': courseManagementHandlers.handleSelectSectionForClasses,
    'select_class_for_management': courseManagementHandlers.handleSelectClassForManagement,
    'select_section_for_groups': courseManagementHandlers.handleSelectSectionForGroups,
    'select_class_for_groups': courseManagementHandlers.handleSelectClassForGroups,
    'select_section_for_professors': courseManagementHandlers.handleSelectSectionForProfessors,
    'select_class_for_professors': courseManagementHandlers.handleSelectClassForProfessors,
    'select_section_for_subjects': courseManagementHandlers.handleSelectSectionForSubjects,
    'select_class_for_subjects': courseManagementHandlers.handleSelectClassForSubjects,
    'add_section': courseManagementHandlers.handleAddSection,
    'edit_section': courseManagementHandlers.handleEditSection,
    'delete_section': courseManagementHandlers.handleDeleteSection,
    'add_class': courseManagementHandlers.handleAddClass,
    'edit_class': courseManagementHandlers.handleEditClass,
    'delete_class': courseManagementHandlers.handleDeleteClass,
    'add_group': courseManagementHandlers.handleAddGroup,
    'edit_group': courseManagementHandlers.handleEditGroup,
    'delete_group': courseManagementHandlers.handleDeleteGroup,
    'add_professor': courseManagementHandlers.handleAddProfessor,
    'edit_professor': courseManagementHandlers.handleEditProfessor,
    'delete_professor': courseManagementHandlers.handleDeleteProfessor,
    'add_subject': courseManagementHandlers.handleAddSubject,
    'edit_subject': courseManagementHandlers.handleEditSubject,
    'delete_subject': courseManagementHandlers.handleDeleteSubject,
};

/**
 * @description المعالج الرئيسي للرسائل التي تكون جزءاً من محادثة نشطة.
 */
async function handleStatefulMessage(message, client) {
    const authorId = message.author || message.from;

    if (!state.userState.has(authorId)) {
        return false;
    }

    const userState = state.userState.get(authorId);
    const content = message.body.trim();

    if (Date.now() - userState.timestamp > (USER_STATE_TIMEOUT || 300000)) {
        state.userState.delete(authorId);
        await message.reply(`⏱️ انتهت صلاحية الجلسة. يرجى البدء من جديد.${SIGNATURE}`);
        return true;
    }

    if (content.toLowerCase() === 'إلغاء' || content.toLowerCase() === 'cancel') {
        state.userState.delete(authorId);
        await message.reply(`✅ تم إلغاء العملية.${SIGNATURE}`);
        return true;
    }

    const handler = allSteps[userState.step];
    if (handler) {
        try {
            userState.timestamp = Date.now(); // تحديث وقت آخر نشاط
            await handler(message, client);
        } catch (error) {
            console.error(`[❌] Error in state handler for step "${userState.step}":`, error);
            await message.reply(`⚠️ حدث خطأ غير متوقع. تم إنهاء العملية.${SIGNATURE}`);
            state.userState.delete(authorId);
        }
    } else {
        console.warn(`[⚠️] No state handler found for step: ${userState.step}.`);
        await message.reply(`⚠️ خطأ في النظام، لا يوجد معالج لهذه الخطوة. تم إنهاء العملية.`);
        state.userState.delete(authorId);
    }

    return true;
}

module.exports = { handleStatefulMessage };