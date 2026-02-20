require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const PdfPrinter = require('pdfmake');
const { exec } = require('child_process');

// --- ربط قاعدة البيانات ---
const db = require('./database.js');

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "whatsapp-bot" }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// ============================================
// حالة البوت والبيانات
// ============================================
const userState = new Map();
const userTimeouts = new Map();
const groupsMetadata = new Map();
const blacklist = new Set();
const admins = new Set(['84564227018@c.us']);

// ============================================
// نظام القفل والفتح المجدول
// ============================================
const scheduledLocks = new Map();   // groupId -> { unlockTime, timeoutId, duration }
const scheduledUnlocks = new Map(); // groupId -> { lockTime, timeoutId, duration }

// دوال مساعدة للقفل والفتح المجدول
function parseTimeInput(timeStr) {
    // تنسيقات مدعومة: 30m, 1h, 2h30m, 30د, 1س, 2س30د
    const arabicToEnglish = timeStr
        .replace(/د/g, 'm')
        .replace(/س/g, 'h')
        .replace(/ /g, '');

    const hoursMatch = arabicToEnglish.match(/(\d+)h/i);
    const minutesMatch = arabicToEnglish.match(/(\d+)m/i);

    let totalMinutes = 0;
    if (hoursMatch) totalMinutes += parseInt(hoursMatch[1]) * 60;
    if (minutesMatch) totalMinutes += parseInt(minutesMatch[1]);

    return totalMinutes > 0 ? totalMinutes : null;
}

function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0 && mins > 0) return `${hours} ساعة و ${mins} دقيقة`;
    if (hours > 0) return `${hours} ساعة`;
    return `${mins} دقيقة`;
}

function formatTimeRemaining(ms) {
    const totalMinutes = Math.ceil(ms / (60 * 1000));
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours > 0 && mins > 0) return `${hours} ساعة و ${mins} دقيقة`;
    if (hours > 0) return `${hours} ساعة`;
    return `${mins} دقيقة`;
}

async function scheduleGroupUnlock(groupId, durationMinutes, replyTo) {
    // إلغاء أي جدولة سابقة
    if (scheduledLocks.has(groupId)) {
        clearTimeout(scheduledLocks.get(groupId).timeoutId);
        scheduledLocks.delete(groupId);
    }

    const unlockTime = Date.now() + (durationMinutes * 60 * 1000);

    const timeoutId = setTimeout(async () => {
        try {
            const chat = await client.getChatById(groupId);
            await chat.setMessagesAdminsOnly(false);
            await client.sendMessage(groupId, `🔓 *تم فتح المجموعة تلقائياً!*\nانتهت مدة القفل (${formatDuration(durationMinutes)}).\nيمكن لجميع الأعضاء إرسال الرسائل الآن.${signature}`);
            scheduledLocks.delete(groupId);
        } catch (error) {
            console.error('خطأ في الفتح التلقائي:', error);
        }
    }, durationMinutes * 60 * 1000);

    scheduledLocks.set(groupId, { unlockTime, timeoutId, duration: durationMinutes });
}

async function scheduleGroupLock(groupId, durationMinutes, replyTo) {
    // إلغاء أي جدولة سابقة
    if (scheduledUnlocks.has(groupId)) {
        clearTimeout(scheduledUnlocks.get(groupId).timeoutId);
        scheduledUnlocks.delete(groupId);
    }

    const lockTime = Date.now() + (durationMinutes * 60 * 1000);

    const timeoutId = setTimeout(async () => {
        try {
            const chat = await client.getChatById(groupId);
            await chat.setMessagesAdminsOnly(true);
            await client.sendMessage(groupId, `🔒 *تم إغلاق المجموعة تلقائياً!*\nانتهت مدة الفتح (${formatDuration(durationMinutes)}).\nلا يمكن إرسال الرسائل الآن سوى للمشرفين.${signature}`);
            scheduledUnlocks.delete(groupId);
        } catch (error) {
            console.error('خطأ في القفل التلقائي:', error);
        }
    }, durationMinutes * 60 * 1000);

    scheduledUnlocks.set(groupId, { lockTime, timeoutId, duration: durationMinutes });
}

// هياكل البيانات
const sections = new Map();     
const classes = new Map();      
const groupsData = new Map();   
const professors = new Map();   
const subjects = new Map();     

// ============================================
// الإعدادات والمتغيرات 
// ============================================
let groupId = null;
let isBotReady = false;

const PDF_ARCHIVE_GROUP = process.env.PDF_ARCHIVE_GROUP || '120363403563982270@g.us';
const EXAMS_ARCHIVE_GROUP = process.env.EXAMS_ARCHIVE_GROUP || '120363425900214633@g.us'; 
const OWNER_ID = process.env.OWNER_ID || '212621957775@c.us'; 
const SECOND_OWNER = '143731667767397@c.us'; 

// قائمة الفصول الثابتة
const FIXED_CLASSES = [
    'الفصل الأول',
    'الفصل الثاني',
    'الفصل الثالث',
    'الفصل الرابع',
    'الفصل الخامس',
    'الفصل السادس'
];

// مسارات الملفات والمجلدات
const blacklistFile = './blacklist.json';
const sectionsFile = './sections.json';
const classesFile = './classes.json';
const groupsFile = './groups.json';
const professorsFile = './professors.json';
const subjectsFile = './subjects.json';

const manualDir = path.join(__dirname, 'manual');
if (!fs.existsSync(manualDir)) { fs.mkdirSync(manualDir, { recursive: true }); }

// توقيع محسّن ومزخرف لرسائل البوت
const signature = "\n\n━━━━━━━━━━━━━━━━━━\n
    \n لا تنسونا بصالح الدعاء 
    👨‍💻 *Dev by:* IRIZI ✨";

// ============================================
// دوال إدارة حالة المستخدم مع المؤقت (Timeout)
// ============================================
function updateState(userId, replyTo, state) {
    if (userTimeouts.has(userId)) {
        clearTimeout(userTimeouts.get(userId));
    }
    userState.set(userId, state);
    const timeout = setTimeout(async () => {
        if (userState.has(userId)) {
            userState.delete(userId);
            userTimeouts.delete(userId);
            try {
                await client.sendMessage(replyTo, `⏳ *انتهت المهلة!*\nلقد استغرقت أكثر من 4 دقائق دون رد. تم إلغاء العملية، يرجى إرسال الأمر من جديد للمتابعة.${signature}`);
            } catch (error) { console.error('فشل إرسال رسالة المهلة', error); }
        }
    }, 4 * 60 * 1000);
    userTimeouts.set(userId, timeout);
}

function clearState(userId) {
    userState.delete(userId);
    if (userTimeouts.has(userId)) {
        clearTimeout(userTimeouts.get(userId));
        userTimeouts.delete(userId);
    }
}

// ============================================
// دوال المساعدة لاستخراج الأرقام
// ============================================
function getCleanNumber(idData) {
    if (!idData) return '';
    let idStr = typeof idData === 'object' ? (idData._serialized || idData.user || '') : idData.toString();
    const match = idStr.match(/^(\d+)/);
    return match ? match[1] : idStr;
}

// ============================================
// دوال تحميل وحفظ البيانات
// ============================================
function loadBlacklist() { try { if (fs.existsSync(blacklistFile)) { const data = fs.readFileSync(blacklistFile, 'utf8'); const list = data ? JSON.parse(data) : []; blacklist.clear(); list.forEach(num => blacklist.add(num)); } } catch (e) {} }
function loadSections() { try { if (fs.existsSync(sectionsFile)) { const data = fs.readFileSync(sectionsFile, 'utf8'); const list = data ? JSON.parse(data) : []; sections.clear(); list.forEach(item => sections.set(item.id, item.name)); } } catch (e) {} }
function loadClasses() { try { if (fs.existsSync(classesFile)) { const data = fs.readFileSync(classesFile, 'utf8'); const list = data ? JSON.parse(data) : []; classes.clear(); list.forEach(item => classes.set(item.id, item.name)); } } catch (e) {} }
function loadGroups() { try { if (fs.existsSync(groupsFile)) { const data = fs.readFileSync(groupsFile, 'utf8'); const list = data ? JSON.parse(data) : []; groupsData.clear(); list.forEach(item => groupsData.set(item.id, item.name)); } } catch (e) {} }
function loadProfessors() { try { if (fs.existsSync(professorsFile)) { const data = fs.readFileSync(professorsFile, 'utf8'); const list = data ? JSON.parse(data) : []; professors.clear(); list.forEach(item => professors.set(item.id, item.name)); } } catch (e) {} }
function loadSubjects() { try { if (fs.existsSync(subjectsFile)) { const data = fs.readFileSync(subjectsFile, 'utf8'); const list = data ? JSON.parse(data) : []; subjects.clear(); list.forEach(item => subjects.set(item.id, item.name)); } } catch (e) {} }

function saveBlacklist() { try { fs.writeFileSync(blacklistFile, JSON.stringify([...blacklist])); } catch (e) {} }
function saveSections() { try { const list = Array.from(sections.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(sectionsFile, JSON.stringify(list, null, 2)); } catch (e) {} }
function saveClasses() { try { const list = Array.from(classes.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(classesFile, JSON.stringify(list, null, 2)); } catch (e) {} }
function saveGroups() { try { const list = Array.from(groupsData.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(groupsFile, JSON.stringify(list, null, 2)); } catch (e) {} }
function saveProfessors() { try { const list = Array.from(professors.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(professorsFile, JSON.stringify(list, null, 2)); } catch (e) {} }
function saveSubjects() { try { const list = Array.from(subjects.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(subjectsFile, JSON.stringify(list, null, 2)); } catch (e) {} }

loadBlacklist(); loadSections(); loadClasses(); loadGroups(); loadProfessors(); loadSubjects();

// ============================================
// دوال PDF (محدثة لتكون مفصلة وأنيقة)
// ============================================
function checkFonts() {
    const fontsDir = path.join(__dirname, 'fonts');
    const regularFont = path.join(fontsDir, 'Amiri-Regular.ttf');
    const boldFont = path.join(fontsDir, 'Amiri-Bold.ttf');
    if (!fs.existsSync(fontsDir)) { fs.mkdirSync(fontsDir); return false; }
    if (!fs.existsSync(regularFont) || !fs.existsSync(boldFont)) return false;
    return true;
}

// دالة لتحويل النص العربي للعرض الصحيح في RTL
function reverseArabicText(text) {
    if (!text) return '';
    // تقسيم النص إلى كلمات وعكس ترتيبها
    return text.split(' ').reverse().join(' ');
}

async function generateLecturesTablePDF(lecturesData) {
    return new Promise((resolve, reject) => {
        try {
            if (!checkFonts()) { 
                reject(new Error('الخطوط المطلوبة غير موجودة.')); 
                return; 
            }
            
            const fonts = { 
                Amiri: { 
                    normal: path.join(__dirname, 'fonts/Amiri-Regular.ttf'), 
                    bold: path.join(__dirname, 'fonts/Amiri-Bold.ttf') 
                } 
            };
            const printer = new PdfPrinter(fonts);

            // الفلترة الذكية للأساتذة والمواد المحذوفة
            const activeProfs = Array.from(professors.values()).map(v => v.trim());
            const activeSubjects = Array.from(subjects.values()).map(v => v.trim());
            const validData = lecturesData.filter(l => 
                activeProfs.includes((l.professor_name || '').trim()) && 
                activeSubjects.includes((l.subject_name || '').trim())
            );

            // تقسيم البيانات
            const lectures = validData.filter(item => item.type === 'محاضرة');
            const summaries = validData.filter(item => item.type === 'ملخص');
            const exams = validData.filter(item => item.type === 'امتحان');

            // دالة مساعدة لتوليد الجداول
            const createTableSection = (title, data, type) => {
                const tableBody = [];
                
                // إعداد الترويسات - تم عكس الترتيب للـ RTL
                if (type === 'امتحان') {
                    tableBody.push([
                        { text: reverseArabicText('التاريخ'), style: 'tableHeader' },
                        { text: reverseArabicText('الأستاذ'), style: 'tableHeader' },
                        { text: reverseArabicText('السنة / الدورة'), style: 'tableHeader' },
                        { text: reverseArabicText('الفصل'), style: 'tableHeader' },
                        { text: reverseArabicText('المادة'), style: 'tableHeader' },
                        { text: reverseArabicText('الشعبة'), style: 'tableHeader' },
                        { text: reverseArabicText('التسلسل'), style: 'tableHeader' }
                    ]);
                    data.forEach((item, index) => {
                        const date = item.date_added 
                            ? new Date(item.date_added).toLocaleDateString('ar-EG') 
                            : reverseArabicText('غير محدد');
                        tableBody.push([
                            reverseArabicText(date),
                            reverseArabicText(item.professor_name || ''),
                            reverseArabicText(item.lecture_number || ''),
                            reverseArabicText(item.class_name || ''),
                            reverseArabicText(item.subject_name || ''),
                            reverseArabicText(item.section_name || ''),
                            (index + 1).toString()
                        ]);
                    });
                } else {
                    tableBody.push([
                        { text: reverseArabicText('التاريخ'), style: 'tableHeader' },
                        { text: reverseArabicText('الفوج'), style: 'tableHeader' },
                        { text: reverseArabicText('الأستاذ'), style: 'tableHeader' },
                        { text: reverseArabicText('الرقم'), style: 'tableHeader' },
                        { text: reverseArabicText('الفصل'), style: 'tableHeader' },
                        { text: reverseArabicText('المادة'), style: 'tableHeader' },
                        { text: reverseArabicText('الشعبة'), style: 'tableHeader' },
                        { text: reverseArabicText('التسلسل'), style: 'tableHeader' }
                    ]);
                    data.forEach((item, index) => {
                        const date = item.date_added 
                            ? new Date(item.date_added).toLocaleDateString('ar-EG') 
                            : reverseArabicText('غير محدد');
                        tableBody.push([
                            reverseArabicText(date),
                            reverseArabicText(item.group_name || ''),
                            reverseArabicText(item.professor_name || ''),
                            reverseArabicText(item.lecture_number || ''),
                            reverseArabicText(item.class_name || ''),
                            reverseArabicText(item.subject_name || ''),
                            reverseArabicText(item.section_name || ''),
                            (index + 1).toString()
                        ]);
                    });
                }

                const section = [
                    { text: reverseArabicText(title), style: 'sectionTitle' }
                ];

                if (data.length > 0) {
                    section.push({
                        table: {
                            headerRows: 1,
                            widths: type === 'امتحان' 
                                ? ['auto', '*', 'auto', 'auto', '*', 'auto', 'auto'] 
                                : ['auto', 'auto', '*', 'auto', 'auto', '*', 'auto', 'auto'],
                            body: tableBody
                        },
                        layout: {
                            fillColor: function (rowIndex) {
                                return (rowIndex === 0) ? '#2C3E50' : (rowIndex % 2 === 0 ? '#ECF0F1' : null);
                            },
                            hLineWidth: function () { return 1; },
                            vLineWidth: function () { return 1; },
                            hLineColor: function () { return '#BDC3C7'; },
                            vLineColor: function () { return '#BDC3C7'; }
                        },
                        margin: [0, 0, 0, 25]
                    });
                } else {
                    section.push({ 
                        text: reverseArabicText('لا توجد بيانات مضافة في هذا القسم حالياً.'), 
                        style: 'noData', 
                        margin: [0, 0, 0, 25] 
                    });
                }

                return section;
            };

            const docDefinition = {
                defaultStyle: { 
                    font: 'Amiri', 
                    alignment: 'right', 
                    fontSize: 11
                },
                content: [
                    { text: reverseArabicText('الأرشيف الأكاديمي الشامل'), style: 'mainTitle' },
                    { 
                        text: reverseArabicText(`تاريخ التحديث: ${new Date().toLocaleDateString('ar-EG')}`), 
                        style: 'subTitle' 
                    },
                    { 
                        canvas: [{ 
                            type: 'line', 
                            x1: 0, y1: 5, 
                            x2: 770, y2: 5, 
                            lineWidth: 2, 
                            lineColor: '#2980B9' 
                        }], 
                        margin: [0, 0, 0, 20] 
                    },
                    
                    ...createTableSection('جدول المحاضرات', lectures, 'محاضرة'),
                    ...createTableSection('جدول الملخصات', summaries, 'ملخص'),
                    ...createTableSection('جدول الامتحانات', exams, 'امتحان')
                ],
                styles: {
                    mainTitle: { 
                        fontSize: 24, 
                        bold: true, 
                        alignment: 'center', 
                        color: '#2C3E50', 
                        margin: [0, 0, 0, 5] 
                    },
                    subTitle: { 
                        fontSize: 12, 
                        alignment: 'center', 
                        color: '#7F8C8D', 
                        margin: [0, 0, 0, 10] 
                    },
                    sectionTitle: { 
                        fontSize: 18, 
                        bold: true, 
                        color: '#2980B9', 
                        margin: [0, 10, 0, 10], 
                        decoration: 'underline' 
                    },
                    tableHeader: { 
                        bold: true, 
                        fontSize: 12, 
                        color: 'white', 
                        alignment: 'center', 
                        margin: [0, 4, 0, 4] 
                    },
                    noData: { 
                        fontSize: 12, 
                        italic: true, 
                        color: '#95A5A6', 
                        alignment: 'center' 
                    }
                },
                pageOrientation: 'landscape', 
                pageSize: 'A4'
            };
            
            const pdfDoc = printer.createPdfKitDocument(docDefinition);
            const chunks = [];
            pdfDoc.on('data', chunk => chunks.push(chunk));
            pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
            pdfDoc.on('error', error => reject(error));
            pdfDoc.end();
        } catch (error) { 
            reject(error); 
        }
    });
}

// أحداث العميل
// ============================================
client.on('qr', qr => { qrcode.generate(qr, { small: true }); });

client.on('ready', async () => {
    console.log('[✅] Client ready!');
    isBotReady = true;
    const chats = await client.getChats();
    for (const chat of chats) { if (chat.isGroup) { groupsMetadata.set(chat.id._serialized, chat.name); } }

    try {
        const startupMessage = `✅ *تم تشغيل النظام بنجاح!* 🚀\nالبوت الآن متصل بالخادم وجاهز لاستقبال الأوامر.${signature}`;
        await client.sendMessage(OWNER_ID, startupMessage);
        await client.sendMessage(SECOND_OWNER, startupMessage);
    } catch (error) { console.error('⚠️ لم أتمكن من إرسال إشعار التشغيل'); }
});

client.on('message_create', async message => {
    try {
        if (!isBotReady || !message) return;

        const isGroupMessage = message.from.includes('@g.us') || message.to.includes('@g.us');
        const currentGroupId = isGroupMessage ? (message.from.includes('@g.us') ? message.from : message.to) : null;
        
        let userIdRaw = message.fromMe ? client.info.wid._serialized : (isGroupMessage ? (message.author || message.from) : message.from);
        const replyTo = isGroupMessage ? currentGroupId : userIdRaw;
        
        const content = message.body && typeof message.body === 'string' ? message.body.trim() : '';
        if (!content && !message.hasMedia) return;

        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || "طالب";

        const authorNumber = getCleanNumber(userIdRaw);
        const botNumber = getCleanNumber(client.info.wid);
        const isOwner = (authorNumber === getCleanNumber(OWNER_ID) || authorNumber === getCleanNumber(SECOND_OWNER));

        // دالة الرد المباشر (Reply)
        const sendReply = async (msgContent, options = {}) => {
            try {
                return await client.sendMessage(replyTo, msgContent, { ...options, quotedMessageId: message.id._serialized });
            } catch (e) {
                return await client.sendMessage(replyTo, msgContent, options);
            }
        };

        // --- أمر الطرد من المجموعة (Kick) ---
        if (isGroupMessage && (content === '!طرد' || content === '!kick')) {
            const chat = await message.getChat();
            let isSenderAdmin = isOwner || Array.from(admins).map(getCleanNumber).includes(authorNumber);
            let isBotGroupAdmin = false;

            for (let participant of chat.participants) {
                if (participant.isAdmin || participant.isSuperAdmin) {
                    const pNum = getCleanNumber(participant.id);
                    if (pNum === authorNumber) isSenderAdmin = true;
                    if (pNum === botNumber) isBotGroupAdmin = true;
                }
            }

            if (!isSenderAdmin) { await message.react('⚠️'); return await sendReply(`⚠️ *عذراً!* هذا الأمر مخصص لمشرفي المجموعة فقط.${signature}`); }
            if (!isBotGroupAdmin) { await message.react('⚠️'); return await sendReply(`⚠️ *عذراً!* يجب أن أكون مشرفاً لأتمكن من طرد الأعضاء.${signature}`); }

            if (!message.hasQuotedMsg) { await message.react('⚠️'); return await sendReply(`⚠️ *طريقة الاستخدام:* قم بعمل "رد/Reply" على أي رسالة للشخص المراد طرده، واكتب الأمر \n*!طرد*${signature}`); }

            try {
                await message.react('⏳');
                const quotedMsg = await message.getQuotedMessage();
                const targetId = quotedMsg.author || quotedMsg.from;
                const cleanTargetId = getCleanNumber(targetId);
                
                if (cleanTargetId === botNumber || cleanTargetId === getCleanNumber(OWNER_ID) || cleanTargetId === getCleanNumber(SECOND_OWNER)) {
                    await message.react('🛡️');
                    return await sendReply(`❌ *عذراً، لا يمكنني طرد هذا الرقم!* 🛡️${signature}`);
                }

                await chat.removeParticipants([targetId]);
                await message.react('✅');
                await sendReply(`✅ *تم طرد العضو بنجاح!* 🧹${signature}`);
            } catch(e) { await message.react('❌'); await sendReply(`❌ *حدث خطأ أثناء الطرد.* تأكد من أنني مشرف (Admin) وأن الشخص لا يزال في المجموعة.${signature}`); }
            return;
        }

                // --- أوامر القفل والفتح مع دعم التوقيت ---
        const lockMatch = content.match(/^!(قفل|lock)(?:\s+(.+))?$/i);
        const unlockMatch = content.match(/^!(فتح|unlock)(?:\s+(.+))?$/i);

        if (lockMatch || unlockMatch) {
            if (!isGroupMessage) return;
            const chat = await message.getChat();

            let isSenderAdmin = isOwner || Array.from(admins).map(getCleanNumber).includes(authorNumber);
            let isBotGroupAdmin = false;

            for (let participant of chat.participants) {
                if (participant.isAdmin || participant.isSuperAdmin) {
                    const pNumber = getCleanNumber(participant.id);
                    if (pNumber === authorNumber) isSenderAdmin = true;
                    if (pNumber === botNumber) isBotGroupAdmin = true;
                }
            }

            if (!isSenderAdmin) { await message.react('⚠️'); return await sendReply(`⚠️ *عذراً!* هذا الأمر مخصص لمشرفي المجموعة فقط.${signature}`); }
            if (!isBotGroupAdmin) { await message.react('⚠️'); return await sendReply(`⚠️ *عذراً!* يجب أن تجعلني مشرفاً (Admin) أولاً لأتمكن من التحكم بالمجموعة.${signature}`); }

            try {
                const isLock = !!lockMatch;
                const timeArg = isLock ? lockMatch[2] : unlockMatch[2];

                await message.react(isLock ? '🔒' : '🔓');
                await chat.setMessagesAdminsOnly(isLock);

                if (isLock) {
                    // إلغاء أي جدولة فتح سابقة
                    if (scheduledLocks.has(currentGroupId)) {
                        clearTimeout(scheduledLocks.get(currentGroupId).timeoutId);
                        scheduledLocks.delete(currentGroupId);
                    }

                    if (timeArg) {
                        const duration = parseTimeInput(timeArg);
                        if (duration) {
                            await scheduleGroupUnlock(currentGroupId, duration, currentGroupId);
                            const unlockAt = new Date(Date.now() + duration * 60 * 1000).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                            await client.sendMessage(currentGroupId, `🔒 *تم إغلاق المجموعة!*\n\n⏱️ *مدة القفل:* ${formatDuration(duration)}\n🔓 *سيفتح تلقائياً عند:* ${unlockAt}\n\n💡 لا يمكن إرسال الرسائل الآن سوى للمشرفين.${signature}`);
                        } else {
                            await client.sendMessage(currentGroupId, `🔒 *تم إغلاق المجموعة!*\n\n⚠️ *تنبيه:* صيغة الوقت غير صحيحة. استخدم مثل: 30m, 1h, 2h30m\n\n💡 لا يمكن إرسال الرسائل الآن سوى للمشرفين.${signature}`);
                        }
                    } else {
                        await client.sendMessage(currentGroupId, `🔒 *تم إغلاق المجموعة!*\n\n💡 لا يمكن إرسال الرسائل الآن سوى للمشرفين.\n\n📌 *لقفل مؤقت:* أرسل \`!قفل 30m\` أو \`!قفل 1h\`${signature}`);
                    }
                } else {
                    // إلغاء أي جدولة قفل سابقة
                    if (scheduledUnlocks.has(currentGroupId)) {
                        clearTimeout(scheduledUnlocks.get(currentGroupId).timeoutId);
                        scheduledUnlocks.delete(currentGroupId);
                    }

                    if (timeArg) {
                        const duration = parseTimeInput(timeArg);
                        if (duration) {
                            await scheduleGroupLock(currentGroupId, duration, currentGroupId);
                            const lockAt = new Date(Date.now() + duration * 60 * 1000).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                            await client.sendMessage(currentGroupId, `🔓 *تم فتح المجموعة!*\n\n⏱️ *مدة الفتح:* ${formatDuration(duration)}\n🔒 *سيغلق تلقائياً عند:* ${lockAt}\n\n💡 يمكن لجميع الأعضاء إرسال الرسائل الآن.${signature}`);
                        } else {
                            await client.sendMessage(currentGroupId, `🔓 *تم فتح المجموعة!*\n\n⚠️ *تنبيه:* صيغة الوقت غير صحيحة. استخدم مثل: 30m, 1h, 2h30m\n\n💡 يمكن لجميع الأعضاء إرسال الرسائل الآن.${signature}`);
                        }
                    } else {
                        await client.sendMessage(currentGroupId, `🔓 *تم فتح المجموعة!*\n\n💡 يمكن لجميع الأعضاء إرسال الرسائل الآن.\n\n📌 *لفتح مؤقت:* أرسل \`!فتح 30m\` أو \`!فتح 1h\`${signature}`);
                    }
                }
            } catch (error) { 
                console.error('خطأ في القفل/الفتح:', error);
                await message.react('❌'); 
                await sendReply(`❌ *حدث خطأ أثناء التنفيذ!* تحقق من الكونسول للمزيد من التفاصيل.${signature}`); 
            }
            return;
        }

        // --- أمر حالة القفل/الفتح ---
        if (content === '!حالة_القفل' || content === '!lock_status') {
            if (!isGroupMessage) return;
            const chat = await message.getChat();

            let isSenderAdmin = isOwner || Array.from(admins).map(getCleanNumber).includes(authorNumber);
            for (let participant of chat.participants) {
                if (participant.isAdmin || participant.isSuperAdmin) {
                    if (getCleanNumber(participant.id) === authorNumber) isSenderAdmin = true;
                }
            }

            if (!isSenderAdmin) { return await sendReply(`⚠️ *عذراً!* هذا الأمر مخصص لمشرفي المجموعة فقط.${signature}`); }

            let statusMsg = `📊 *حالة القفل/الفتح*\n━━━━━━━━━━━━━━━━━━\n`;

            const isLocked = chat.groupMetadata.announce === true;
            statusMsg += isLocked ? `🔒 *الحالة:* مغلقة\n` : `🔓 *الحالة:* مفتوحة\n`;

            if (scheduledLocks.has(currentGroupId)) {
                const { unlockTime, duration } = scheduledLocks.get(currentGroupId);
                const remaining = unlockTime - Date.now();
                statusMsg += `\n⏱️ *قفل مؤقت:*\n📅 المدة: ${formatDuration(duration)}\n⏳ المتبقي: ${formatTimeRemaining(remaining)}\n🔓 يفتح عند: ${new Date(unlockTime).toLocaleTimeString('ar-EG')}`;
            }

            if (scheduledUnlocks.has(currentGroupId)) {
                const { lockTime, duration } = scheduledUnlocks.get(currentGroupId);
                const remaining = lockTime - Date.now();
                statusMsg += `\n⏱️ *فتح مؤقت:*\n📅 المدة: ${formatDuration(duration)}\n⏳ المتبقي: ${formatTimeRemaining(remaining)}\n🔒 يغلق عند: ${new Date(lockTime).toLocaleTimeString('ar-EG')}`;
            }

            if (!scheduledLocks.has(currentGroupId) && !scheduledUnlocks.has(currentGroupId)) {
                statusMsg += `\n💡 لا يوجد قفل/فتح مجدول حالياً.`;
            }

            statusMsg += `\n\n📌 *لإلغاء الجدولة:* أرسل \`!إلغاء_الجدولة\`${signature}`;
            await sendReply(statusMsg);
            return;
        }

        // --- أمر إلغاء جدولة القفل/الفتح ---
        if (content === '!إلغاء_الجدولة' || content === '!cancel_schedule') {
            if (!isGroupMessage) return;
            const chat = await message.getChat();

            let isSenderAdmin = isOwner || Array.from(admins).map(getCleanNumber).includes(authorNumber);
            for (let participant of chat.participants) {
                if (participant.isAdmin || participant.isSuperAdmin) {
                    if (getCleanNumber(participant.id) === authorNumber) isSenderAdmin = true;
                }
            }

            if (!isSenderAdmin) { return await sendReply(`⚠️ *عذراً!* هذا الأمر مخصص لمشرفي المجموعة فقط.${signature}`); }

            let cancelled = false;
            if (scheduledLocks.has(currentGroupId)) {
                clearTimeout(scheduledLocks.get(currentGroupId).timeoutId);
                scheduledLocks.delete(currentGroupId);
                cancelled = true;
            }
            if (scheduledUnlocks.has(currentGroupId)) {
                clearTimeout(scheduledUnlocks.get(currentGroupId).timeoutId);
                scheduledUnlocks.delete(currentGroupId);
                cancelled = true;
            }

            if (cancelled) {
                await message.react('✅');
                await sendReply(`✅ *تم إلغاء الجدولة بنجاح!*\nلم يعد هناك قفل/فتح تلقائي.${signature}`);
            } else {
                await sendReply(`⚠️ *لا يوجد جدولة نشطة* لإلغائها.${signature}`);
            }
            return;
        }

        // --- أمر رابط المجموعة ---
        if (content === '!رابط' || content === '!رابط_المجموعة' || content === '!link') {
            if (!isGroupMessage) { return await sendReply(`⚠️ *هذا الأمر يعمل داخل المجموعات فقط.*${signature}`); }
            const chat = await message.getChat();
            let isBotGroupAdmin = false;
            for (let participant of chat.participants) {
                if (participant.isAdmin || participant.isSuperAdmin) { if (getCleanNumber(participant.id) === botNumber) isBotGroupAdmin = true; }
            }

            if (isBotGroupAdmin) {
                try {
                    await message.react('🔗');
                    const inviteCode = await chat.getInviteCode();
                    const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                    await sendReply(`🔗 *رابط الانضمام للمجموعة:*\n\n${inviteLink}\n\n💡 _شارك الرابط مع زملائك للانضمام!_${signature}`);
                } catch (error) { await message.react('❌'); await sendReply(`❌ *حدث خطأ!* تأكد أن خاصية دعوة عبر الرابط مفعلة.${signature}`); }
            } else { await message.react('⚠️'); await sendReply(`⚠️ *عذراً!* يجب على إدارة المجموعة أن تجعل البوت مشرفاً أولاً.${signature}`); }
            return;
        }

                // --- أمر تثبيت الرسالة (محسّن) ---
        if (isGroupMessage && (content === '!تثبيت' || content === '!pin')) {
            const chat = await message.getChat();
            let isSenderAdmin = isOwner || Array.from(admins).map(getCleanNumber).includes(authorNumber);
            let isBotGroupAdmin = false;

            for (let participant of chat.participants) {
                if (participant.isAdmin || participant.isSuperAdmin) {
                    const pNum = getCleanNumber(participant.id);
                    if (pNum === authorNumber) isSenderAdmin = true;
                    if (pNum === botNumber) isBotGroupAdmin = true;
                }
            }

            if (!isSenderAdmin) { 
                await message.react('⚠️'); 
                return await sendReply(`⚠️ *عذراً!* هذا الأمر مخصص لمشرفي المجموعة فقط.${signature}`); 
            }
            if (!isBotGroupAdmin) { 
                await message.react('⚠️'); 
                return await sendReply(`⚠️ *عذراً!* يجب أن أكون مشرفاً لأتمكن من التثبيت.${signature}`); 
            }

            // التحقق من وجود رسالة مُرد عليها
            if (!message.hasQuotedMsg) { 
                await message.react('❓'); 
                return await sendReply(
                    `📌 *كيفية استخدام أمر التثبيت:*\n\n` +
                    `1️⃣ اضغط مطولاً على الرسالة المراد تثبيتها\n` +
                    `2️⃣ اختر *رد / Reply*\n` +
                    `3️⃣ اكتب الأمر: *!تثبيت*\n\n` +
                    `💡 *ملاحظة:* يمكن تثبيت أي نوع من الرسائل (نص، صورة، ملف، إلخ)\n` +
                    `⚠️ يجب أن تكون مشرفاً في المجموعة${signature}`
                ); 
            }

            try {
                await message.react('⏳');
                const quotedMsg = await message.getQuotedMessage();

                // التحقق من أن الرسالة موجودة ولم يتم حذفها
                if (!quotedMsg) {
                    await message.react('❌');
                    return await sendReply(`❌ *تعذر العثور على الرسالة!*\nقد تكون الرسالة قديمة جداً أو تم حذفها.${signature}`);
                }

                // محاولة تثبيت الرسالة
                await quotedMsg.pin(24 * 60 * 60); // تثبيت لمدة 24 ساعة (أقصى مدة في الواتساب)

                await message.react('📌');

                // الحصول على معلومات إضافية عن الرسالة المثبتة
                let pinInfo = `✅ *تم تثبيت الرسالة بنجاح!* 📌\n\n`;
                pinInfo += `👤 *المرسل الأصلي:* ${quotedMsg.author ? quotedMsg.author.split('@')[0] : 'غير معروف'}\n`;
                pinInfo += `🕐 *تاريخ الإرسال:* ${new Date(quotedMsg.timestamp * 1000).toLocaleString('ar-EG')}\n`;
                pinInfo += `⏱️ *مدة التثبيت:* 24 ساعة (تلقائي)\n\n`;
                pinInfo += `💡 *لإلغاء التثبيت:* اضغط على الرسالة المثبتة واختر "إلغاء التثبيت"`;

                await sendReply(pinInfo + signature);

            } catch(e) { 
                console.error('خطأ في التثبيت:', e);
                await message.react('❌'); 
                let errorMsg = `❌ *حدث خطأ أثناء التثبيت!*\n\n`;
                if (e.message && e.message.includes('not authorized')) {
                    errorMsg += `⚠️ *السبب:* البوت لا يملك صلاحية التثبيت.\nتأكد من جعل البوت مشرفاً في المجموعة.`;
                } else if (e.message && e.message.includes('too old')) {
                    errorMsg += `⚠️ *السبب:* الرسالة قديمة جداً ولا يمكن تثبيتها.`;
                } else {
                    errorMsg += `⚠️ *تفاصيل الخطأ:* ${e.message || 'خطأ غير معروف'}`;
                }
                await sendReply(errorMsg + signature); 
            }
            return;
        }

        // --- أمر إلغاء تثبيت الرسالة ---
        if (isGroupMessage && (content === '!إلغاء_تثبيت' || content === '!unpin')) {
            const chat = await message.getChat();
            let isSenderAdmin = isOwner || Array.from(admins).map(getCleanNumber).includes(authorNumber);
            let isBotGroupAdmin = false;

            for (let participant of chat.participants) {
                if (participant.isAdmin || participant.isSuperAdmin) {
                    const pNum = getCleanNumber(participant.id);
                    if (pNum === authorNumber) isSenderAdmin = true;
                    if (pNum === botNumber) isBotGroupAdmin = true;
                }
            }

            if (!isSenderAdmin) { 
                await message.react('⚠️'); 
                return await sendReply(`⚠️ *عذراً!* هذا الأمر مخصص لمشرفي المجموعة فقط.${signature}`); 
            }
            if (!isBotGroupAdmin) { 
                await message.react('⚠️'); 
                return await sendReply(`⚠️ *عذراً!* يجب أن أكون مشرفاً لأتمكن من إلغاء التثبيت.${signature}`); 
            }

            if (!message.hasQuotedMsg) { 
                await message.react('❓'); 
                return await sendReply(
                    `📌 *كيفية إلغاء التثبيت:*\n\n` +
                    `1️⃣ اضغط مطولاً على الرسالة المثبتة\n` +
                    `2️⃣ اختر *رد / Reply*\n` +
                    `3️⃣ اكتب الأمر: *!إلغاء_تثبيت*\n\n` +
                    `⚠️ يجب أن تكون مشرفاً في المجموعة${signature}`
                ); 
            }

            try {
                await message.react('⏳');
                const quotedMsg = await message.getQuotedMessage();

                if (!quotedMsg) {
                    await message.react('❌');
                    return await sendReply(`❌ *تعذر العثور على الرسالة!*${signature}`);
                }

                await quotedMsg.unpin();
                await message.react('✅');
                await sendReply(`✅ *تم إلغاء تثبيت الرسالة بنجاح!* 🗑️${signature}`);

            } catch(e) { 
                console.error('خطأ في إلغاء التثبيت:', e);
                await message.react('❌'); 
                await sendReply(`❌ *حدث خطأ أثناء إلغاء التثبيت!*\nقد لا تكون هذه الرسالة مثبتة أصلاً.${signature}`); 
            }
            return;
        }

        // --- أمر البدء وعرض الأوامر (Start) ---
        if (content === '!start' || content === '!الأوامر' || content === '!الاوامر') {
            await message.react('🤖');
            const helpMsg = `🤖 *مرحباً بك في البوت الأكاديمي!* 📚\n\n` +
                            `إليك قائمة بجميع الأوامر المتاحة مع شرحها:\n\n` +
                            `📌 *أوامر عامة للطلاب:*\n` +
                            `*!start* أو *!الأوامر* : لعرض هذه القائمة.\n` +
                            `*!دليل* أو *!help* : للحصول على كتاب وفيديو يوضحان كيفية الاستخدام.\n` +
                            `*!تحميل* : للبحث عن المحاضرات، الملخصات، أو الامتحانات وتحميلها.\n` +
                            `*!جدول_المحاضرات* : لاستخراج جدول (PDF) بجميع المحاضرات والملخصات.\n` +
                            `*!رابط* : للحصول على رابط الانضمام للمجموعة.\n\n` +
                            `📥 *أوامر الإضافة (رفع الملفات):*\n` +
                            `*!اضافة_pdf* : لإضافة محاضرة أو ملخص جديد للأرشيف.\n` +
                            `*!اضافة_امتحان* : لإضافة صور امتحانات جديدة للأرشيف.\n\n` +
                            `🛠️ *أوامر مشرفي المجموعات:*\n` +
                            `*!طرد* : (بالرد على رسالة العضو) لطرده من المجموعة.\n` +
                            `*!قفل* : لإغلاق المجموعة مؤقتاً (مثال: !قفل 30m).\n` +
                            `*!فتح* : لفتح المجموعة (مثال: !فتح 1h).\n` +
                            `*!حالة_القفل* : لمعرفة حالة القفل والفتح المجدول.\n` +
                            `*!إلغاء_الجدولة* : لإلغاء القفل أو الفتح التلقائي.\n` +
                            `*!تثبيت* : (بالرد على رسالة) لتثبيتها في المجموعة.\n` +
                            `*!إلغاء_تثبيت* : (بالرد على رسالة) لإلغاء تثبيتها.\n\n` +
                        
                            `${signature}`;
            
            await sendReply(helpMsg);
            return;
        }

        // --- أمر دليل الاستخدام ---
        if (content === '!دليل' || content === '!مساعدة' || content === '!help') {
            if (!isGroupMessage) return; 
            await message.react('📖');
            const pdfPath = path.join(manualDir, 'manual.pdf');
            const videoPath = path.join(manualDir, 'tutorial.mp4');
            let filesSent = false;
            
            if (fs.existsSync(videoPath)) { const videoMedia = MessageMedia.fromFilePath(videoPath); await sendReply(videoMedia, { caption: `🎥 *فيديو توضيحي لطريقة الاستخدام*${signature}` }); filesSent = true; }
            if (fs.existsSync(pdfPath)) { const pdfMedia = MessageMedia.fromFilePath(pdfPath); await sendReply(pdfMedia, { caption: `📖 *كتاب دليل الاستخدام*\nاقرأ هذا الدليل لمعرفة جميع ميزات البوت وكيفية استغلالها بالشكل الصحيح. ✨${signature}` }); filesSent = true; }
            if (!filesSent) { await sendReply(`⚠️ *دليل الاستخدام قيد الإعداد حالياً!*\nيرجى الانتظار حتى تقوم الإدارة برفعه قريباً.${signature}`); }
            return;
        }

        // --- أمر التحديث من GitHub ---
        if (!isGroupMessage && isOwner && content === '!تحديث') {
            await message.react('🔄');
            await sendReply(`🔄 *جاري سحب التحديثات من GitHub...*\nسيتم إعادة تشغيل البوت تلقائياً خلال ثوانٍ.${signature}`);
            exec('git pull origin main && pm2 restart all', async (error) => {
                if (error) await sendReply(`⚠️ *حدث خطأ أثناء التحديث:*\n${error.message}${signature}`);
            });
            return;
        }

        // --- أمر جدول المحاضرات ---
        if (content === '!جدول_المحاضرات' || content === '!lectures_table') {
            try {
                await message.react('📊');
                const res = await db.query('SELECT * FROM lectures ORDER BY id ASC');
                if (res.rows.length === 0) { await sendReply(`⚠️ *عذراً!* لا توجد بيانات مضافة حتى الآن.${signature}`); return; }
                const pdfBuffer = await generateLecturesTablePDF(res.rows);
                const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), `جدول.pdf`);
                await sendReply(media, { caption: `📊 *إليك جدول الأرشيف الشامل محدثاً* ✨${signature}` });
                await message.react('✅');
            } catch (error) { await sendReply(`❌ *حدث خطأ!* لم أتمكن من إنشاء الجدول، يرجى المحاولة لاحقاً.${signature}`); await message.react('❌'); }
            return;
        }

        // --- أمر إنشاء مجموعة أرشيف جديدة (للامتحانات) ---
        if (!isGroupMessage && isOwner && (content === '!انشاء_ارشيف' || content === '!create_archive')) {
            await sendReply(`⏳ *جاري إنشاء مجموعة الأرشيف الجديدة...*${signature}`);
            try {
                const response = await client.createGroup('📸 أرشيف الامتحانات السري', [authorNumber + '@c.us']);
                const newGroupId = response.gid._serialized;

                const successMsg = `✅ *تم إنشاء مجموعة الأرشيف بنجاح!*\n\n` +
                                   `📌 *الاسم:* 📸 أرشيف الامتحانات السري\n` +
                                   `🆔 *معرف المجموعة (Group ID):*\n*${newGroupId}*\n\n` +
                                   `⚠️ *الخطوة التالية:*\nانسخ الـ ID المكتوب بالأعلى، واذهب إلى أعلى ملف \`index.js\` وأضفه في متغير \`EXAMS_ARCHIVE_GROUP\`.${signature}`;
                
                await sendReply(successMsg);
                await client.sendMessage(newGroupId, `🤖 *مرحباً!*\nتم تخصيص هذه المجموعة لتكون أرشيفاً سرياً لحفظ الامتحانات بواسطة البوت.\nيرجى عدم مغادرتها أو حذف الرسائل منها.${signature}`);
            } catch (error) {
                console.error('خطأ في إنشاء المجموعة:', error);
                await sendReply(`❌ *حدث خطأ أثناء إنشاء المجموعة!*\nتأكد أن حساب البوت غير مقيد من إنشاء المجموعات.${signature}`);
            }
            return;
        }

        // --- لوحة الإدارة ---
        if (!isGroupMessage && isOwner && content === '!إدارة') {
            await message.react('🛠️');
            await sendReply(`🛠️ *لوحة تحكم المدير* 🛠️\n━━━━━━━━━━━━━━━━━━\n\n👥 *الأعضاء والمشرفين:*\n1. ➕ إضافة عضو\n2. ➖ حذف عضو\n3. ⬆️ ترقية عضو\n4. ⬇️ خفض مشرف\n5. 👨‍💻 إضافة مبرمج\n6. ❌ حذف مبرمج\n7. 🧹 تنظيف المجموعة\n\n⚙️ *إدارة المحتوى:*\n8. 📌 تثبيت رسالة\n9. 📊 جدول المحاضرات\n10. 📚 إدارة المحاضرات\n\n🗂️ *إدارة البيانات:*\n11. 🏷️ إدارة الشعب\n12. 🏫 إدارة الفصول\n13. 👥 إدارة الأفواج\n14. 👨‍🏫 إدارة الأساتذة\n15. 📖 إدارة المواد\n\n📢 *التواصل:*\n16. 🌐 بث لجميع المجموعات\n17. 🎯 بث لمجموعة مخصصة\n\n📖 *دليل الاستخدام (للطلاب):*\n18. 📚 رفع/تحديث كتاب الدليل (PDF)\n19. 🎥 رفع/تحديث فيديو الشرح (MP4)\n\n━━━━━━━━━━━━━━━━━━\n💡 _أرسل رقم الخيار لتنفيذه أو اكتب_ *إلغاء* _للخروج._${signature}`);
            updateState(userIdRaw, replyTo, { step: 'admin_menu', timestamp: Date.now() });
            return;
        }

        // --- أوامر الملفات (إضافة وتحميل) ---
        if (content === '!اضافة_pdf' || content === '!add pdf') {
            if (!isGroupMessage) return;
            if (sections.size === 0) { await sendReply(`⚠️ *لم يتم إعداد بيانات الشعب بعد!* الرجاء إضافتها من لوحة الإدارة أولاً.${signature}`); return; }
            await message.react('📄');
            await sendReply(`📄 *إضافة ملف جديد* 📄\n━━━━━━━━━━━━━━━━━━\nأهلاً بك! يرجى اختيار نوع الملف الذي تود إضافته:\n\n1️⃣ 📚 محاضرة\n2️⃣ 📝 ملخص\n\n💡 _أرسل الرقم المطلوب أو اكتب_ *إلغاء* _للرجوع._${signature}`);
            updateState(userIdRaw, replyTo, { step: 'select_pdf_type' });
            return;
        }

        if (content === '!تحميل' || content === '!download') {
            if (!isGroupMessage) return;
            if (sections.size === 0) { await sendReply(`⚠️ *لم يتم إعداد بيانات الشعب بعد!*${signature}`); return; }
            await message.react('📥');
            await sendReply(`📥 *تحميل الملفات والامتحانات* 📥\n━━━━━━━━━━━━━━━━━━\nأهلاً بك! يرجى اختيار النوع الذي تبحث عنه:\n\n1️⃣ 📚 محاضرة\n2️⃣ 📝 ملخص\n3️⃣ 📸 امتحان\n\n💡 _أرسل الرقم المطلوب أو اكتب_ *إلغاء* _للرجوع._${signature}`);
            updateState(userIdRaw, replyTo, { step: 'select_pdf_type_for_download' });
            return;
        }

        if (content === '!اضافة_امتحان' || content === '!add exam') {
            if (!isGroupMessage) return;
            if (sections.size === 0) { await sendReply(`⚠️ *لم يتم إعداد بيانات الشعب بعد!* الرجاء إضافتها من لوحة الإدارة أولاً.${signature}`); return; }
            await message.react('📸');
            let sectionsList = `📸 *إضافة امتحان جديد* 📸\n━━━━━━━━━━━━━━━━━━\nأهلاً بك! يرجى اختيار الشعبة الخاصة بهذا الامتحان:\n\n`; 
            let index = 1;
            for (const [id, name] of sections) { sectionsList += `${index++}. ${name}\n`; }
            await sendReply(sectionsList + `\n💡 _أرسل رقم الشعبة أو اكتب_ *إلغاء*${signature}`);
            updateState(userIdRaw, replyTo, { step: 'select_section_for_exam', pdfType: 'امتحان' });
            return;
        }

        // ================================
        // معالج الحالات للعمليات (State Handler)
        // ================================
        if (userState.has(userIdRaw)) {
            const state = userState.get(userIdRaw);

            if (content.toLowerCase() === 'إلغاء') {
                await message.react('❌');
                await sendReply(`✅ *تم الإلغاء بنجاح!* ✨${signature}`);
                clearState(userIdRaw);
                return;
            }

            // --- رفع ملفات الدليل (من الإدارة) ---
            if (state.step === 'waiting_for_manual_pdf') {
                if (message.hasMedia && message.type === 'document') {
                    const media = await message.downloadMedia();
                    if (media.mimetype === 'application/pdf') {
                        await message.react('⏳');
                        fs.writeFileSync(path.join(manualDir, 'manual.pdf'), Buffer.from(media.data, 'base64'));
                        await sendReply(`✅ *تم حفظ كتاب الدليل (PDF) بنجاح!* ✨\nيمكن للطلاب الآن استدعاءه بأمر !دليل.${signature}`);
                        await message.react('✅');
                    } else { await sendReply(`⚠️ *يرجى إرسال ملف بصيغة PDF فقط!*${signature}`); }
                } else { await sendReply(`⚠️ *لم تقم بإرسال أي ملف PDF.* يرجى المحاولة مرة أخرى.${signature}`); }
                clearState(userIdRaw); return;
            }

            if (state.step === 'waiting_for_manual_video') {
                if (message.hasMedia && message.type === 'video') {
                    await message.react('⏳');
                    const media = await message.downloadMedia();
                    fs.writeFileSync(path.join(manualDir, 'tutorial.mp4'), Buffer.from(media.data, 'base64'));
                    await sendReply(`✅ *تم حفظ فيديو الشرح بنجاح!* ✨\nسيتم إرساله للطلاب مع أمر !دليل.${signature}`);
                    await message.react('✅');
                } else { await sendReply(`⚠️ *لم تقم بإرسال أي فيديو.* يرجى المحاولة مرة أخرى.${signature}`); }
                clearState(userIdRaw); return;
            }

            // --- عمليات إضافة PDF (محاضرة/ملخص) ---
            if (state.step === 'select_pdf_type') {
                const option = parseInt(content);
                if (option !== 1 && option !== 2) { await sendReply(`⚠️ *خيار غير صحيح!* يرجى اختيار 1 للمحاضرة أو 2 للملخص.${signature}`); return; }
                state.pdfType = option === 1 ? 'محاضرة' : 'ملخص'; state.step = 'select_section'; 
                updateState(userIdRaw, replyTo, state);
                let sectionsList = `📚 *اختر الشعبة:*\n━━━━━━━━━━━━━━━━━━\n`; let index = 1;
                for (const [id, name] of sections) { sectionsList += `${index++}. ${name}\n`; }
                await sendReply(sectionsList + `\n💡 _أرسل رقم الشعبة أو اكتب_ *إلغاء*${signature}`);
                return;
            }

            if (state.step === 'select_section') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) { await sendReply(`⚠️ *خيار غير صحيح!* يرجى اختيار رقم الشعبة الصحيح.${signature}`); return; }
                const sectionId = Array.from(sections.keys())[option - 1];
                state.sectionId = sectionId; state.sectionName = sections.get(sectionId); 
                state.step = 'select_class_for_add'; 
                updateState(userIdRaw, replyTo, state);
                
                let classList = `🏫 *اختر الفصل:*\n━━━━━━━━━━━━━━━━━━\n`;
                FIXED_CLASSES.forEach((c, index) => { classList += `${index + 1}. ${c}\n`; });
                await sendReply(classList + `\n💡 _أرسل رقم الفصل أو اكتب_ *إلغاء*${signature}`);
                return;
            }

            if (state.step === 'select_section_for_exam') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) { await sendReply(`⚠️ *خيار غير صحيح!* يرجى اختيار رقم الشعبة الصحيح.${signature}`); return; }
                const sectionId = Array.from(sections.keys())[option - 1];
                state.sectionId = sectionId; state.sectionName = sections.get(sectionId); 
                state.step = 'select_class_for_exam_add'; 
                updateState(userIdRaw, replyTo, state);

                let classList = `🏫 *اختر الفصل:*\n━━━━━━━━━━━━━━━━━━\n`;
                FIXED_CLASSES.forEach((c, index) => { classList += `${index + 1}. ${c}\n`; });
                await sendReply(classList + `\n💡 _أرسل رقم الفصل أو اكتب_ *إلغاء*${signature}`);
                return;
            }

            if (state.step === 'select_class_for_add' || state.step === 'select_class_for_exam_add') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 6) { await sendReply(`⚠️ *خيار غير صحيح!* يرجى اختيار رقم من 1 إلى 6.${signature}`); return; }
                
                state.className = FIXED_CLASSES[option - 1]; 
                
                if (state.step === 'select_class_for_exam_add') {
                    state.step = 'waiting_exam_form';
                    updateState(userIdRaw, replyTo, state);
                    await sendReply(`✅ *تم اختيار ${state.className}!*\nيرجى نسخ الاستمارة التالية وملئها:\n\nسنة الامتحان (أو الدورة): \nالمادة: \nالأستاذ: \n\n⚠️ *ملاحظة:* املأ البيانات بعد النقطتين (:) ثم أرسلها.\n\n📸 *تنبيه:* بعد ملء الاستمارة سيُطلب منك إرسال صورة الامتحان.${signature}`);
                } else {
                    state.step = 'waiting_form';
                    updateState(userIdRaw, replyTo, state);
                    await sendReply(`✅ *تم اختيار ${state.className}!*\nيرجى نسخ الاستمارة التالية وملئها:\n\nرقم ${state.pdfType}: \nالمادة: \nالأستاذ: \nالفوج: \n\n⚠️ *ملاحظة:* املأ البيانات بعد النقطتين (:) ثم أرسلها.${signature}`);
                }
                return;
            }

            if (state.step === 'waiting_form') {
                const lines = content.split('\n'); const info = {};
                lines.forEach(line => {
                    if (line.includes('رقم')) info.number = line.split(':')[1]?.trim();
                    if (line.includes('المادة')) info.subject = line.split(':')[1]?.trim();
                    if (line.includes('الأستاذ') || line.includes('الاستاد')) info.professor = line.split(':')[1]?.trim();
                    if (line.includes('الفوج')) info.group = line.split(':')[1]?.trim();
                });
                if (!info.number || !info.subject || !info.professor || !info.group) { await sendReply(`⚠️ *الاستمارة ناقصة!* يرجى ملء كافة البيانات.${signature}`); return; }
                state.formData = info; state.step = 'waiting_pdf'; 
                updateState(userIdRaw, replyTo, state);
                await sendReply(`✅ *تم استلام البيانات.* يرجى الآن إرسال ملف الـ *PDF* المطلوب لـ (${state.className}).${signature}`);
                return;
            }

            if (state.step === 'waiting_exam_form') {
                const lines = content.split('\n'); const info = {};
                lines.forEach(line => {
                    if (line.includes('سنة') || line.includes('دورة')) info.number = line.split(':')[1]?.trim();
                    if (line.includes('المادة')) info.subject = line.split(':')[1]?.trim();
                    if (line.includes('الأستاذ') || line.includes('الاستاد')) info.professor = line.split(':')[1]?.trim();
                });
                if (!info.number || !info.subject || !info.professor) { await sendReply(`⚠️ *الاستمارة ناقصة!* يرجى ملء كافة البيانات.${signature}`); return; }
                state.formData = info; state.step = 'waiting_exam_image'; 
                updateState(userIdRaw, replyTo, state);
                await sendReply(`✅ *تم استلام البيانات.* يرجى الآن إرسال *صورة* الامتحان.\n\n📸 *ملاحظة:* يمكن إرسال صورة واحدة أو عدة صور للامتحان.${signature}`);
                return;
            }

            if (state.step === 'waiting_pdf') {
                if (message.hasMedia && message.type === 'document') {
                    const media = await message.downloadMedia();
                    if (media.mimetype === 'application/pdf') {
                        await message.react('⏳');
                        const caption = `📚 *${state.pdfType} جديد*\n📖 المادة: ${state.formData.subject}\n📝 رقم: ${state.formData.number}\n🏫 الفصل: ${state.className}\n👨‍🏫 الأستاذ: ${state.formData.professor}\n👥 الفوج: ${state.formData.group}\n📚 الشعبة: ${state.sectionName}\n👤 أضيف بواسطة: ${senderName}\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n${signature}`;

                        try {
                            const archiveMsg = await client.sendMessage(PDF_ARCHIVE_GROUP, media, { caption });
                            const messageId = archiveMsg.id._serialized;
                            const query = `INSERT INTO lectures (type, section_id, section_name, class_name, subject_name, professor_name, group_name, lecture_number, message_id, added_by, date_added, file_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`;
                            const values = [state.pdfType, state.sectionId, state.sectionName, state.className, state.formData.subject, state.formData.professor, state.formData.group, state.formData.number, messageId, senderName, media.filename || 'lecture.pdf'];
                            await db.query(query, values);
                            
                            await sendReply(`✅ *تم حفظ الـ ${state.pdfType} بنجاح!* 🎉\n📖 المادة: ${state.formData.subject}\n📝 الرقم: ${state.formData.number}${signature}`);
                            await message.react('✅');
                        } catch (error) {
                            console.error('خطأ في الحفظ:', error);
                            await sendReply(`❌ *حدث خطأ أثناء الحفظ!* يرجى المحاولة مرة أخرى.${signature}`);
                        }
                    } else { await sendReply(`⚠️ *يرجى إرسال ملف بصيغة PDF فقط!*${signature}`); }
                } else { await sendReply(`⚠️ *لم تقم بإرسال أي ملف PDF.* يرجى إرسال الملف المطلوب.${signature}`); }
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'waiting_exam_image') {
                // دعم الصور للامتحانات
                if (message.hasMedia && (message.type === 'image' || message.type === 'document')) {
                    const media = await message.downloadMedia();
                    
                    // التحقق من أن الملف صورة
                    const isImage = media.mimetype && media.mimetype.startsWith('image/');
                    const isImageDocument = message.type === 'document' && (
                        media.mimetype === 'image/jpeg' || 
                        media.mimetype === 'image/png' || 
                        media.mimetype === 'image/jpg' ||
                        media.mimetype === 'image/webp'
                    );
                    
                    if (isImage || isImageDocument) {
                        await message.react('⏳');
                        const caption = `📸 *امتحان جديد*\n📖 المادة: ${state.formData.subject}\n📅 السنة/الدورة: ${state.formData.number}\n🏫 الفصل: ${state.className}\n👨‍🏫 الأستاذ: ${state.formData.professor}\n📚 الشعبة: ${state.sectionName}\n👤 أضيف بواسطة: ${senderName}\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n${signature}`;

                        try {
                            const archiveMsg = await client.sendMessage(EXAMS_ARCHIVE_GROUP, media, { caption });
                            const messageId = archiveMsg.id._serialized;
                            const query = `INSERT INTO lectures (type, section_id, section_name, class_name, subject_name, professor_name, lecture_number, message_id, added_by, date_added, file_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)`;
                            const fileExt = media.mimetype.split('/')[1] || 'jpg';
                            const values = ['امتحان', state.sectionId, state.sectionName, state.className, state.formData.subject, state.formData.professor, state.formData.number, messageId, senderName, `exam.${fileExt}`];
                            await db.query(query, values);
                            
                            await sendReply(`✅ *تم حفظ صورة الامتحان بنجاح!* 🎉\n📖 المادة: ${state.formData.subject}\n📅 السنة/الدورة: ${state.formData.number}${signature}`);
                            await message.react('✅');
                        } catch (error) {
                            console.error('خطأ في الحفظ:', error);
                            await sendReply(`❌ *حدث خطأ أثناء الحفظ!* يرجى المحاولة مرة أخرى.${signature}`);
                        }
                    } else { 
                        await sendReply(`⚠️ *يرجى إرسال صورة فقط!*\n📸 الصيغ المدعومة: JPG, PNG, WEBP${signature}`); 
                    }
                } else { 
                    await sendReply(`⚠️ *لم تقم بإرسال أي صورة.* يرجى إرسال صورة الامتحان.\n\n📸 *تنبيه:* الامتحانات يجب أن تكون صوراً وليست ملفات PDF.${signature}`); 
                }
                clearState(userIdRaw);
                return;
            }

            // --- عمليات التحميل (Download) ---
            if (state.step === 'select_pdf_type_for_download') {
                const option = parseInt(content);
                if (option < 1 || option > 3) { await sendReply(`⚠️ *خيار غير صحيح!* يرجى اختيار رقم من 1 إلى 3.${signature}`); return; }
                state.downloadType = option === 1 ? 'محاضرة' : (option === 2 ? 'ملخص' : 'امتحان');
                state.step = 'select_section_for_download';
                updateState(userIdRaw, replyTo, state);
                
                let sectionsList = `📚 *اختر الشعبة:*\n━━━━━━━━━━━━━━━━━━\n`; let idx = 1;
                for (const [id, name] of sections) { sectionsList += `${idx++}. ${name}\n`; }
                await sendReply(sectionsList + `\n💡 _أرسل رقم الشعبة أو اكتب_ *إلغاء*${signature}`);
                return;
            }

            if (state.step === 'select_section_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) { await sendReply(`⚠️ *خيار غير صحيح!* يرجى اختيار رقم الشعبة الصحيح.${signature}`); return; }
                const sectionId = Array.from(sections.keys())[option - 1];
                state.sectionId = sectionId; state.sectionName = sections.get(sectionId);
                state.step = 'select_class_for_download';
                updateState(userIdRaw, replyTo, state);
                
                let classList = `🏫 *اختر الفصل:*\n━━━━━━━━━━━━━━━━━━\n`;
                FIXED_CLASSES.forEach((c, index) => { classList += `${index + 1}. ${c}\n`; });
                await sendReply(classList + `\n💡 _أرسل رقم الفصل أو اكتب_ *إلغاء*${signature}`);
                return;
            }

            if (state.step === 'select_class_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 6) { await sendReply(`⚠️ *خيار غير صحيح!* يرجى اختيار رقم من 1 إلى 6.${signature}`); return; }
                state.className = FIXED_CLASSES[option - 1];
                
                try {
                    const query = `SELECT * FROM lectures WHERE type = $1 AND section_name = $2 AND class_name = $3 ORDER BY date_added DESC`;
                    const res = await db.query(query, [state.downloadType, state.sectionName, state.className]);
                    
                    if (res.rows.length === 0) {
                        await sendReply(`⚠️ *لا توجد ${state.downloadType}ات متاحة لهذه الشعبة والفصل حالياً.*${signature}`);
                    } else {
                        let listMsg = `📚 *قائمة ${state.downloadType}ات المتاحة*\n📖 الشعبة: ${state.sectionName}\n🏫 الفصل: ${state.className}\n━━━━━━━━━━━━━━━━━━\n\n`;
                        res.rows.forEach((item, idx) => {
                            const date = new Date(item.date_added).toLocaleDateString('ar-EG');
                            if (state.downloadType === 'امتحان') {
                                listMsg += `${idx + 1}. 📖 ${item.subject_name} | 📅 ${item.lecture_number} | 👨‍🏫 ${item.professor_name} | 📆 ${date}\n`;
                            } else {
                                listMsg += `${idx + 1}. 📖 ${item.subject_name} | 📝 ${item.lecture_number} | 👨‍🏫 ${item.professor_name} | 👥 ${item.group_name || '-'} | 📆 ${date}\n`;
                            }
                        });
                        listMsg += `\n💡 _أرسل رقم ${state.downloadType} للتحميل أو اكتب_ *إلغاء*`;
                        
                        state.availableItems = res.rows;
                        state.step = 'select_item_to_download';
                        updateState(userIdRaw, replyTo, state);
                        await sendReply(listMsg + signature);
                    }
                } catch (error) {
                    console.error('خطأ في البحث:', error);
                    await sendReply(`❌ *حدث خطأ أثناء البحث!* يرجى المحاولة لاحقاً.${signature}`);
                    clearState(userIdRaw);
                }
                return;
            }

            if (state.step === 'select_item_to_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > state.availableItems.length) {
                    await sendReply(`⚠️ *خيار غير صحيح!* يرجى اختيار رقم صحيح.${signature}`);
                    return;
                }
                
                const selectedItem = state.availableItems[option - 1];
                await message.react('⏳');
                
                try {
                    // استرجاع الملف من المجموعة الأرشيف
                    const archiveGroupId = state.downloadType === 'امتحان' ? EXAMS_ARCHIVE_GROUP : PDF_ARCHIVE_GROUP;
                    const chat = await client.getChatById(archiveGroupId);
                    const messages = await chat.fetchMessages({ limit: 100 });
                    
                    // البحث عن الرسالة بالمعرف
                    const targetMessage = messages.find(msg => msg.id._serialized === selectedItem.message_id);
                    
                    if (targetMessage && targetMessage.hasMedia) {
                        const media = await targetMessage.downloadMedia();
                        await sendReply(media, { 
                            caption: `📥 *${state.downloadType}*\n📖 المادة: ${selectedItem.subject_name}\n${state.downloadType === 'امتحان' ? '📅 السنة/الدورة' : '📝 الرقم'}: ${selectedItem.lecture_number}\n👨‍🏫 الأستاذ: ${selectedItem.professor_name}${signature}` 
                        });
                        await message.react('✅');
                    } else {
                        await sendReply(`❌ *عذراً، لم أتمكن من استرجاع الملف.* قد يكون تم حذفه من الأرشيف.${signature}`);
                        await message.react('❌');
                    }
                } catch (error) {
                    console.error('خطأ في التحميل:', error);
                    await sendReply(`❌ *حدث خطأ أثناء تحميل الملف!* يرجى المحاولة لاحقاً.${signature}`);
                    await message.react('❌');
                }
                
                clearState(userIdRaw);
                return;
            }

            // --- لوحة الإدارة ---
            if (state.step === 'admin_menu') {
                const option = parseInt(content);
                
                switch(option) {
                    case 1: // إضافة عضو
                        await sendReply(`👤 *إضافة عضو لمجموعة*\n\nيرجى إرسال رابط المجموعة أو معرف المجموعة (Group ID) ثم رقم العضو بصيغة:\n\nمعرف_المجموعة رقم_العضو\n\nمثال:\n120363xxx@g.us 212600000000${signature}`);
                        state.step = 'add_member_group';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 2: // حذف عضو
                        await sendReply(`👤 *حذف عضو من مجموعة*\n\nيرجى إرسال معرف المجموعة ورقم العضو بصيغة:\n\nمعرف_المجموعة رقم_العضو${signature}`);
                        state.step = 'remove_member_group';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 3: // ترقية عضو
                        await sendReply(`⬆️ *ترقية عضو لمشرف*\n\nيرجى إرسال معرف المجموعة ورقم العضو بصيغة:\n\nمعيد_المجموعة رقم_العضو${signature}`);
                        state.step = 'promote_member';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 4: // خفض مشرف
                        await sendReply(`⬇️ *خفض مشرف إلى عضو*\n\nيرجى إرسال معرف المجموعة ورقم المشرف بصيغة:\n\nمعرف_المجموعة رقم_المشرف${signature}`);
                        state.step = 'demote_member';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 5: // إضافة مبرمج
                        await sendReply(`👨‍💻 *إضافة مبرمج جديد*\n\nيرجى إرسال رقم المبرمج الجديد (بدون + أو مسافات):${signature}`);
                        state.step = 'add_admin';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 6: // حذف مبرمج
                        await sendReply(`❌ *حذف مبرمج*\n\nيرجى إرسال رقم المبرمج المراد حذفه:${signature}`);
                        state.step = 'remove_admin';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 7: // تنظيف المجموعة
                        await sendReply(`🧹 *تنظيف مجموعة*\n\nيرجى إرسال معرف المجموعة المراد تنظيفها:${signature}`);
                        state.step = 'clean_group';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 8: // تثبيت رسالة
                        await sendReply(`📌 *تثبيت رسالة*\n\nقم بالرد (Reply) على الرسالة المراد تثبيتها في أي مجموعة واكتب:\n!تثبيت${signature}`);
                        clearState(userIdRaw);
                        break;
                        
                    case 9: // جدول المحاضرات
                        try {
                            const res = await db.query('SELECT * FROM lectures ORDER BY id ASC');
                            if (res.rows.length === 0) {
                                await sendReply(`⚠️ *لا توجد بيانات مضافة حتى الآن.*${signature}`);
                            } else {
                                const pdfBuffer = await generateLecturesTablePDF(res.rows);
                                const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), `جدول_الأرشيف.pdf`);
                                await sendReply(media, { caption: `📊 *جدول الأرشيف الشامل* ✨${signature}` });
                            }
                        } catch (error) {
                            await sendReply(`❌ *حدث خطأ!*${signature}`);
                        }
                        clearState(userIdRaw);
                        break;
                        
                    case 10: // إدارة المحاضرات
                        await sendReply(`📚 *إدارة المحاضرات*\n\n1. 📊 عرض الإحصائيات\n2. 🗑️ حذف محاضرة\n3. 🔄 تحديث بيانات\n\n💡 أرسل رقم الخيار:${signature}`);
                        state.step = 'manage_lectures';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 11: // إدارة الشعب
                        await sendReply(`🏷️ *إدارة الشعب*\n\nالشعب الحالية:\n${Array.from(sections.values()).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n1. ➕ إضافة شعبة\n2. ➖ حذف شعبة\n\n💡 أرسل رقم الخيار أو اسم الشعبة الجديدة:${signature}`);
                        state.step = 'manage_sections';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 12: // إدارة الفصول
                        await sendReply(`🏫 *إدارة الفصول*\n\nالفصول الحالية:\n${FIXED_CLASSES.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n💡 الفصول ثابتة ولا يمكن تعديلها.${signature}`);
                        clearState(userIdRaw);
                        break;
                        
                    case 13: // إدارة الأفواج
                        await sendReply(`👥 *إدارة الأفواج*\n\nالأفواج الحالية:\n${Array.from(groupsData.values()).map((g, i) => `${i + 1}. ${g}`).join('\n') || 'لا توجد أفواج'}\n\n1. ➕ إضافة فوج\n2. ➖ حذف فوج\n\n💡 أرسل رقم الخيار:${signature}`);
                        state.step = 'manage_groups';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 14: // إدارة الأساتذة
                        await sendReply(`👨‍🏫 *إدارة الأساتذة*\n\nالأساتذة الحاليون:\n${Array.from(professors.values()).map((p, i) => `${i + 1}. ${p}`).join('\n') || 'لا يوجد أساتذة'}\n\n1. ➕ إضافة أستاذ\n2. ➖ حذف أستاذ\n\n💡 أرسل رقم الخيار:${signature}`);
                        state.step = 'manage_professors';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 15: // إدارة المواد
                        await sendReply(`📖 *إدارة المواد*\n\nالمواد الحالية:\n${Array.from(subjects.values()).map((s, i) => `${i + 1}. ${s}`).join('\n') || 'لا توجد مواد'}\n\n1. ➕ إضافة مادة\n2. ➖ حذف مادة\n\n💡 أرسل رقم الخيار:${signature}`);
                        state.step = 'manage_subjects';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 16: // بث لجميع المجموعات
                        await sendReply(`🌐 *بث لجميع المجموعات*\n\nيرجى إرسال الرسالة أو الصورة أو الملف المراد بثه:${signature}`);
                        state.step = 'broadcast_all';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 17: // بث لمجموعة مخصصة
                        await sendReply(`🎯 *بث لمجموعة مخصصة*\n\nيرجى إرسال معرف المجموعة ثم الرسالة بصيغة:\n\nمعرف_المجموعة | الرسالة${signature}`);
                        state.step = 'broadcast_specific';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 18: // رفع دليل PDF
                        await sendReply(`📚 *رفع كتاب الدليل (PDF)*\n\nيرجى إرسال ملف PDF الخاص بدليل الاستخدام:${signature}`);
                        state.step = 'waiting_for_manual_pdf';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    case 19: // رفع فيديو الشرح
                        await sendReply(`🎥 *رفع فيديو الشرح*\n\nيرجى إرسال الفيديو التوضيحي:${signature}`);
                        state.step = 'waiting_for_manual_video';
                        updateState(userIdRaw, replyTo, state);
                        break;
                        
                    default:
                        await sendReply(`⚠️ *خيار غير صحيح!* يرجى إرسال رقم من 1 إلى 19.${signature}`);
                }
                return;
            }

            // --- معالجة أوامر الإدارة الفرعية ---
            if (state.step === 'add_admin') {
                const adminNumber = content.replace(/[^0-9]/g, '');
                if (adminNumber.length < 10) {
                    await sendReply(`⚠️ *رقم غير صحيح!*${signature}`);
                    return;
                }
                admins.add(adminNumber + '@c.us');
                await sendReply(`✅ *تم إضافة المبرمج بنجاح!* 🎉\nرقم: ${adminNumber}${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'remove_admin') {
                const adminNumber = content.replace(/[^0-9]/g, '');
                admins.delete(adminNumber + '@c.us');
                await sendReply(`✅ *تم حذف المبرمج بنجاح!*${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'manage_sections') {
                if (content === '1') {
                    state.step = 'add_section';
                    updateState(userIdRaw, replyTo, state);
                    await sendReply(`➕ *إضافة شعبة جديدة*\n\nيرجى إرسال اسم الشعبة:${signature}`);
                } else if (content === '2') {
                    state.step = 'remove_section';
                    updateState(userIdRaw, replyTo, state);
                    let list = `➖ *حذف شعبة*\n\nالشعب الحالية:\n`;
                    Array.from(sections.entries()).forEach(([id, name], i) => {
                        list += `${i + 1}. ${name}\n`;
                    });
                    await sendReply(list + `\n💡 أرسل رقم الشعبة المراد حذفها:${signature}`);
                } else {
                    // إضافة شعبة جديدة مباشرة
                    const newId = Date.now().toString();
                    sections.set(newId, content);
                    saveSections();
                    await sendReply(`✅ *تم إضافة الشعبة بنجاح!* 🎉\nالشعبة: ${content}${signature}`);
                    clearState(userIdRaw);
                }
                return;
            }

            if (state.step === 'add_section') {
                const newId = Date.now().toString();
                sections.set(newId, content);
                saveSections();
                await sendReply(`✅ *تم إضافة الشعبة بنجاح!* 🎉\nالشعبة: ${content}${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'remove_section') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await sendReply(`⚠️ *خيار غير صحيح!*${signature}`);
                    return;
                }
                const sectionId = Array.from(sections.keys())[option - 1];
                const sectionName = sections.get(sectionId);
                sections.delete(sectionId);
                saveSections();
                await sendReply(`✅ *تم حذف الشعبة بنجاح!* 🗑️\nالشعبة: ${sectionName}${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'manage_groups') {
                if (content === '1') {
                    state.step = 'add_group';
                    updateState(userIdRaw, replyTo, state);
                    await sendReply(`➕ *إضافة فوج جديد*\n\nيرجى إرسال اسم الفوج:${signature}`);
                } else if (content === '2') {
                    state.step = 'remove_group';
                    updateState(userIdRaw, replyTo, state);
                    let list = `➖ *حذف فوج*\n\nالأفواج الحالية:\n`;
                    Array.from(groupsData.entries()).forEach(([id, name], i) => {
                        list += `${i + 1}. ${name}\n`;
                    });
                    await sendReply(list + `\n💡 أرسل رقم الفوج المراد حذفه:${signature}`);
                }
                return;
            }

            if (state.step === 'add_group') {
                const newId = Date.now().toString();
                groupsData.set(newId, content);
                saveGroups();
                await sendReply(`✅ *تم إضافة الفوج بنجاح!* 🎉\nالفوج: ${content}${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'remove_group') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > groupsData.size) {
                    await sendReply(`⚠️ *خيار غير صحيح!*${signature}`);
                    return;
                }
                const groupId = Array.from(groupsData.keys())[option - 1];
                const groupName = groupsData.get(groupId);
                groupsData.delete(groupId);
                saveGroups();
                await sendReply(`✅ *تم حذف الفوج بنجاح!* 🗑️\nالفوج: ${groupName}${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'manage_professors') {
                if (content === '1') {
                    state.step = 'add_professor';
                    updateState(userIdRaw, replyTo, state);
                    await sendReply(`➕ *إضافة أستاذ جديد*\n\nيرجى إرسال اسم الأستاذ:${signature}`);
                } else if (content === '2') {
                    state.step = 'remove_professor';
                    updateState(userIdRaw, replyTo, state);
                    let list = `➖ *حذف أستاذ*\n\nالأساتذة الحاليون:\n`;
                    Array.from(professors.entries()).forEach(([id, name], i) => {
                        list += `${i + 1}. ${name}\n`;
                    });
                    await sendReply(list + `\n💡 أرسل رقم الأستاذ المراد حذفه:${signature}`);
                }
                return;
            }

            if (state.step === 'add_professor') {
                const newId = Date.now().toString();
                professors.set(newId, content);
                saveProfessors();
                await sendReply(`✅ *تم إضافة الأستاذ بنجاح!* 🎉\nالأستاذ: ${content}${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'remove_professor') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > professors.size) {
                    await sendReply(`⚠️ *خيار غير صحيح!*${signature}`);
                    return;
                }
                const profId = Array.from(professors.keys())[option - 1];
                const profName = professors.get(profId);
                professors.delete(profId);
                saveProfessors();
                await sendReply(`✅ *تم حذف الأستاذ بنجاح!* 🗑️\nالأستاذ: ${profName}${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'manage_subjects') {
                if (content === '1') {
                    state.step = 'add_subject';
                    updateState(userIdRaw, replyTo, state);
                    await sendReply(`➕ *إضافة مادة جديدة*\n\nيرجى إرسال اسم المادة:${signature}`);
                } else if (content === '2') {
                    state.step = 'remove_subject';
                    updateState(userIdRaw, replyTo, state);
                    let list = `➖ *حذف مادة*\n\nالمواد الحالية:\n`;
                    Array.from(subjects.entries()).forEach(([id, name], i) => {
                        list += `${i + 1}. ${name}\n`;
                    });
                    await sendReply(list + `\n💡 أرسل رقم المادة المراد حذفها:${signature}`);
                }
                return;
            }

            if (state.step === 'add_subject') {
                const newId = Date.now().toString();
                subjects.set(newId, content);
                saveSubjects();
                await sendReply(`✅ *تم إضافة المادة بنجاح!* 🎉\nالمادة: ${content}${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'remove_subject') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > subjects.size) {
                    await sendReply(`⚠️ *خيار غير صحيح!*${signature}`);
                    return;
                }
                const subjId = Array.from(subjects.keys())[option - 1];
                const subjName = subjects.get(subjId);
                subjects.delete(subjId);
                saveSubjects();
                await sendReply(`✅ *تم حذف المادة بنجاح!* 🗑️\nالمادة: ${subjName}${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'broadcast_all') {
                // بث لجميع المجموعات
                const chats = await client.getChats();
                const groups = chats.filter(c => c.isGroup);
                let sentCount = 0;
                
                for (const group of groups) {
                    try {
                        if (message.hasMedia) {
                            const media = await message.downloadMedia();
                            await client.sendMessage(group.id._serialized, media, { caption: content + signature });
                        } else {
                            await client.sendMessage(group.id._serialized, content + signature);
                        }
                        sentCount++;
                    } catch (e) {
                        console.error(`فشل الإرسال إلى ${group.name}:`, e.message);
                    }
                }
                
                await sendReply(`✅ *تم البث بنجاح!* 📡\nتم الإرسال إلى ${sentCount} مجموعة.${signature}`);
                clearState(userIdRaw);
                return;
            }

            if (state.step === 'broadcast_specific') {
                const [groupIdStr, ...msgParts] = content.split('|');
                const targetGroupId = groupIdStr.trim();
                const msg = msgParts.join('|').trim();
                
                try {
                    await client.sendMessage(targetGroupId, msg + signature);
                    await sendReply(`✅ *تم إرسال الرسالة بنجاح!* 📤${signature}`);
                } catch (e) {
                    await sendReply(`❌ *فشل الإرسال!* تأكد من صحة معرف المجموعة.${signature}`);
                }
                clearState(userIdRaw);
                return;
            }
        }

    } catch (error) {
        console.error('خطأ عام:', error);
    }
});

// تشغيل البوت
client.initialize();
