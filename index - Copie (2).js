const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const PdfPrinter = require('pdfmake');

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

// Bot state and data
const userState = new Map();
const groupsMetadata = new Map();
const blacklist = new Set();
const admins = new Set(['212715104027@c.us']);
const lectureStats = new Map();
const joinStats = new Map();
const leaveStats = new Map();
const messageStats = new Map();

let groupId = null;
let requestCount = 0;
let isBotReady = false;
const PDF_ARCHIVE_GROUP = '120363398139579320@g.us';
const IMAGES_ARCHIVE_GROUP = '120363400468776166@g.us';
const OWNER_ID = '212621957775@c.us';
const PROTECTION_PASSWORD = process.env.BOT_PASSWORD || 'your_secure_password';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';

let lecturesMetadata = [];
const lecturesFile = './lectures.json';
const lecturesDir = './lectures/';
const statsFile = './stats.json';
const blacklistFile = './blacklist.json';

if (!fs.existsSync(lecturesDir)) {
    fs.mkdirSync(lecturesDir);
}

// Load data from files
function loadLectures() {
    try {
        if (fs.existsSync(lecturesFile)) {
            const data = fs.readFileSync(lecturesFile, 'utf8');
            lecturesMetadata = data ? JSON.parse(data) : [];
            console.log(`[📂] Loaded ${lecturesMetadata.length} lectures`);
        } else {
            lecturesMetadata = [];
            fs.writeFileSync(lecturesFile, JSON.stringify([]));
        }
    } catch (error) {
        console.error('[❌] Error loading lectures:', error);
        lecturesMetadata = [];
        fs.writeFileSync(lecturesFile, JSON.stringify([]));
    }
}

function loadStats() {
    try {
        if (fs.existsSync(statsFile)) {
            const data = fs.readFileSync(statsFile, 'utf8');
            const stats = data ? JSON.parse(data) : {};
            joinStats.clear();
            leaveStats.clear();
            messageStats.clear();
            lectureStats.clear();
            for (const [groupId, joins] of Object.entries(stats.joins || {})) {
                joinStats.set(groupId, joins);
            }
            for (const [groupId, leaves] of Object.entries(stats.leaves || {})) {
                leaveStats.set(groupId, leaves);
            }
            for (const [groupId, messages] of Object.entries(stats.messages || {})) {
                messageStats.set(groupId, messages);
            }
            for (const [userId, lectures] of Object.entries(stats.lectures || {})) {
                lectureStats.set(userId, lectures);
            }
            console.log(`[📊] Loaded stats`);
        }
    } catch (error) {
        console.error('[❌] Error loading stats:', error);
    }
}

function loadBlacklist() {
    try {
        if (fs.existsSync(blacklistFile)) {
            const data = fs.readFileSync(blacklistFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            blacklist.clear();
            list.forEach(num => blacklist.add(num));
            console.log(`[📛] Loaded ${blacklist.size} blacklisted numbers`);
        }
    } catch (error) {
        console.error('[❌] Error loading blacklist:', error);
    }
}

function saveLectures() {
    try {
        fs.writeFileSync(lecturesFile, JSON.stringify(lecturesMetadata, null, 2));
        console.log('[💾] Saved lectures');
    } catch (error) {
        console.error('[❌] Error saving lectures:', error);
    }
}

function saveStats() {
    try {
        const stats = {
            joins: Object.fromEntries(joinStats),
            leaves: Object.fromEntries(leaveStats),
            messages: Object.fromEntries(messageStats),
            lectures: Object.fromEntries(lectureStats)
        };
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        console.log('[💾] Saved stats');
    } catch (error) {
        console.error('[❌] Error saving stats:', error);
    }
}

function saveBlacklist() {
    try {
        fs.writeFileSync(blacklistFile, JSON.stringify([...blacklist]));
        console.log('[💾] Saved blacklist');
    } catch (error) {
        console.error('[❌] Error saving blacklist:', error);
    }
}

loadLectures();
loadStats();
loadBlacklist();

const signature = "\n👨‍💻 *dev by: IRIZI 😊*";

// دالة للتواصل مع Gemini API
async function askGemini(prompt, context = '') {
    try {
        const fullPrompt = context ? `${context}\n\nالسؤال: ${prompt}` : prompt;
        
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: fullPrompt
                                }
                            ]
                        }
                    ]
                })
            }
        );

        const data = await response.json();

        if (data && data.candidates && data.candidates.length > 0) {
            const text = data.candidates[0].content.parts[0].text;
            return text;
        } else {
            return "عذراً، لم أتمكن من الحصول على إجابة من الذكاء الاصطناعي.";
        }
    } catch (error) {
        console.error('[❌] Error calling Gemini API:', error);
        return "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.";
    }
}

// دالة لتحليل نية المستخدم باستخدام Gemini
async function analyzeUserIntent(message, senderName, isGroup, groupName = '') {
    try {
        const context = `
أنت مساعد ذكاء اصطناعي لبوت WhatsApp. مهمتك هي تحليل نية المستخدم من رسالته والرد بشكل مناسب.

المعلومات المتاحة:
- اسم المرسل: ${senderName}
- الرسالة من مجموعة: ${isGroup ? 'نعم' : 'لا'}
${isGroup ? `- اسم المجموعة: ${groupName}` : ''}
- الرسالة: ${message}

الرد يجب أن يكون بتنسيق JSON يحتوي على:
{
  "intent": "النية (مثل: سؤال، شكوى، طلب مساعدة، إلخ)",
  "response": "الرد المناسب للمستخدم",
  "action": "إجراء يجب على البوت اتخاذه (مثل: none, notify_admin, add_to_blacklist, إلخ)",
  "confidence": "مستوى الثقة (من 0 إلى 1)"
}
`;

        const aiResponse = await askGemini(`حلل نية المستخدم من هذه الرسالة ورد بشكل مناسب.`, context);
        
        try {
            return JSON.parse(aiResponse);
        } catch (parseError) {
            console.error('[❌] Error parsing AI response:', parseError);
            return {
                intent: "unknown",
                response: "عذراً، لم أفهم رسالتك. هل يمكنك توضيح ما تحتاجه؟",
                action: "none",
                confidence: 0.2
            };
        }
    } catch (error) {
        console.error('[❌] Error analyzing user intent:', error);
        return {
            intent: "unknown",
            response: "حدث خطأ أثناء معالجة رسالتك. يرجى المحاولة مرة أخرى لاحقاً.",
            action: "none",
            confidence: 0.1
        };
    }
}

// دالة لإنشاء رسائل ترحيب مخصصة باستخدام الذكاء الاصطناعي
async function generateWelcomeMessage(userName, groupName) {
    try {
        const context = `
أنت مساعد ذكاء اصطناعي لبوت WhatsApp. مهمتك هي إنشاء رسالة ترحيب دافئة وودية لعضو جديد في المجموعة.

المعلومات المتاحة:
- اسم العضو الجديد: ${userName}
- اسم المجموعة: ${groupName}

الرد يجب أن يكون رسالة ترحيب قصيرة ودافئة، لا تزيد عن 3 أسطر.
`;

        const aiResponse = await askGemini(`أنشئ رسالة ترحيب للعضو الجديد.`, context);
        return aiResponse;
    } catch (error) {
        console.error('[❌] Error generating welcome message:', error);
        return `مرحباً ${userName} في مجموعة ${groupName}! 🎉`;
    }
}

// دالة للتحقق من وجود الخطوط
function checkFonts() {
    const fontsDir = path.join(__dirname, 'fonts');
    const regularFont = path.join(fontsDir, 'Amiri-Regular.ttf');
    const boldFont = path.join(fontsDir, 'Amiri-Bold.ttf');
    
    if (!fs.existsSync(fontsDir)) {
        console.log('[❌] Fonts directory not found. Creating...');
        fs.mkdirSync(fontsDir);
        return false;
    }
    
    if (!fs.existsSync(regularFont)) {
        console.log('[❌] Amiri-Regular.ttf not found in fonts directory');
        return false;
    }
    
    if (!fs.existsSync(boldFont)) {
        console.log('[❌] Amiri-Bold.ttf not found in fonts directory');
        return false;
    }
    
    console.log('[✅] All fonts are available');
    return true;
}

// دالة لإنشاء جدول المحاضرات كملف PDF باستخدام pdfmake
async function generateLecturesTablePDF(lecturesData) {
    return new Promise((resolve, reject) => {
        try {
            console.log('[📊] Starting PDF generation...');
            console.log(`[📊] Number of lectures: ${lecturesData.length}`);
            
            // التحقق من وجود الخطوط
            if (!checkFonts()) {
                reject(new Error('الخطوط المطلوبة غير موجودة. يرجى التأكد من وجود ملفات Amiri-Regular.ttf و Amiri-Bold.ttf في مجلد fonts'));
                return;
            }

            // تعريف الخطوط
            const fonts = {
                Amiri: {
                    normal: path.join(__dirname, 'fonts/Amiri-Regular.ttf'),
                    bold: path.join(__dirname, 'fonts/Amiri-Bold.ttf'),
                }
            };

            console.log('[📊] Creating PDF printer...');
            const printer = new PdfPrinter(fonts);

            // إعداد الجدول
            console.log('[📊] Preparing table data...');
            const body = [
                [
                    { text: 'التسلسل', bold: true },
                    { text: 'المادة', bold: true },
                    { text: 'رقم المحاضرة', bold: true },
                    { text: 'الأستاذ', bold: true },
                    { text: 'الفوج', bold: true },
                    { text: 'التاريخ', bold: true }
                ]
            ];

            lecturesData.forEach((lecture, index) => {
                const date = lecture.date
                    ? new Date(lecture.date).toLocaleDateString('ar-EG')
                    : 'غير محدد';

                body.push([
                    (index + 1).toString(),
                    lecture.subject || '',
                    lecture.lectureNumber || '',
                    lecture.professor || '',
                    lecture.groupNumber || '',
                    date
                ]);
            });

            console.log('[📊] Creating document definition...');
            const docDefinition = {
                defaultStyle: {
                    font: 'Amiri',
                    alignment: 'right', // محاذاة عربية
                    fontSize: 12
                },
                content: [
                    { text: 'جدول المحاضرات', style: 'header' },
                    { text: `تاريخ الإنشاء: ${new Date().toLocaleDateString('ar-EG')}`, alignment: 'left' },
                    {
                        table: {
                            headerRows: 1,
                            widths: ['auto', '*', 'auto', '*', 'auto', 'auto'],
                            body
                        },
                        layout: 'lightHorizontalLines'
                    },
                    { text: `إجمالي المحاضرات: ${lecturesData.length}`, margin: [0, 10, 0, 0] },
                    { text: 'تم إنشاء هذا الجدول باستخدام الذكاء الاصطناعي', alignment: 'center', fontSize: 10, color: 'gray' }
                ],
                styles: {
                    header: {
                        fontSize: 18,
                        bold: true,
                        alignment: 'center',
                        margin: [0, 0, 0, 10]
                    }
                },
                pageOrientation: 'landscape',
                pageSize: 'A4'
            };

            console.log('[📊] Creating PDF document...');
            const pdfDoc = printer.createPdfKitDocument(docDefinition);

            const chunks = [];
            pdfDoc.on('data', chunk => {
                chunks.push(chunk);
                console.log(`[📊] Received chunk: ${chunk.length} bytes`);
            });
            
            pdfDoc.on('end', () => {
                console.log('[📊] PDF generation completed');
                const buffer = Buffer.concat(chunks);
                console.log(`[📊] Final PDF size: ${buffer.length} bytes`);
                resolve(buffer);
            });
            
            pdfDoc.on('error', (error) => {
                console.error('[❌] PDF generation error:', error);
                reject(error);
            });
            
            pdfDoc.end();

        } catch (error) {
            console.error('[❌] Error in generateLecturesTablePDF:', error);
            reject(error);
        }
    });
}

// Utility functions
async function notifyAllGroups(messageText) {
    if (!isBotReady) return;
    
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        for (const group of groups) {
            if (await isBotAdmin(group.id._serialized)) {
                await client.sendMessage(group.id._serialized, messageText + signature);
                console.log(`[📢] Sent to group: ${group.id._serialized}`);
            }
        }
    } catch (error) {
        console.error('[❌] Error notifying groups:', error);
    }
}

async function notifyAdmins(groupId, text) {
    if (!isBotReady) return;
    
    try {
        const chat = await client.getChatById(groupId);
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        for (const admin of admins) {
            await client.sendMessage(admin.id._serialized, `📢 *Admin Notification*\n${text}${signature}`);
        }
    } catch (error) {
        console.error('[❌] Error notifying admins:', error);
    }
}

async function isAdmin(userId, groupId) {
    if (!isBotReady) return false;
    
    try {
        // Owner is always admin
        if (userId === OWNER_ID) return true;
        
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) return false;
        
        // Check if user is in admins list
        if (admins.has(userId)) return true;
        
        // Check if user is group admin
        const groupAdmins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return groupAdmins.some(admin => admin.id._serialized === userId);
    } catch (error) {
        console.error('[❌] Error checking admin status:', error);
        return false;
    }
}

async function isBotAdmin(groupId) {
    if (!isBotReady) return false;
    
    try {
        const chat = await client.getChatById(groupId);
        const botId = client.info.wid._serialized;
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return admins.some(admin => admin.id._serialized === botId);
    } catch (error) {
        console.error('[❌] Error checking bot admin status:', error);
        return false;
    }
}

async function verifyGroup(groupId, groupName) {
    if (!isBotReady) return false;
    
    try {
        await client.getChatById(groupId);
        return true;
    } catch (error) {
        console.error(`[❌] Error: Group ${groupName} not found:`, error);
        return false;
    }
}

function formatPhoneNumber(number) {
    number = number.replace(/\D/g, '');
    if (!number.startsWith('+')) number = '+' + number;
    return number;
}

// Client events with enhanced debugging
client.on('qr', qr => {
    console.log('[📸] Scan QR code:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('[✅] Authenticated successfully!');
});

client.on('auth_failure', msg => {
    console.error('[❌] Authentication failure:', msg);
    isBotReady = false;
});

client.on('ready', async () => {
    console.log('[✅] Client ready!');
    isBotReady = true;
    
    try {
        const chats = await client.getChats();
        for (const chat of chats) {
            if (chat.isGroup) {
                groupsMetadata.set(chat.id._serialized, chat.name);
            }
        }
        console.log(`[ℹ️] Loaded ${groupsMetadata.size} groups`);
        
        // Send test message to owner with delay
        setTimeout(async () => {
            try {
                if (isBotReady) {
                    await client.sendMessage(OWNER_ID, '✅ البوت يعمل الآن!' + signature);
                    console.log('[📤] Test message sent to owner');
                }
            } catch (error) {
                console.error('[❌] Error sending test message:', error);
            }
        }, 5000); // Wait 5 seconds before sending
    } catch (error) {
        console.error('[❌] Error in ready event:', error);
    }
});

client.on('disconnected', reason => {
    console.log('[❌] Client disconnected:', reason);
    isBotReady = false;
});

client.on('group_join', async (notification) => {
    if (!isBotReady) return;
    
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    console.log(`[📢] User ${userId} joined ${groupId}`);
    
    if (blacklist.has(userId)) {
        if (await isBotAdmin(groupId)) {
            await client.removeParticipant(groupId, userId);
            console.log(`[📛] Removed blacklisted user ${userId}`);
        }
        return;
    }
    
    joinStats.set(groupId, joinStats.get(groupId) || []);
    joinStats.get(groupId).push({ userId, timestamp: Date.now() });
    saveStats();
    
    // Generate AI welcome message
    try {
        const contact = await client.getContactById(userId);
        const userName = contact.pushname || contact.name || "عضو جديد";
        const groupName = groupsMetadata.get(groupId) || "المجموعة";
        
        const welcomeMessage = await generateWelcomeMessage(userName, groupName);
        await client.sendMessage(groupId, welcomeMessage);
    } catch (error) {
        console.error('[❌] Error sending AI welcome message:', error);
    }
});

client.on('group_leave', async (notification) => {
    if (!isBotReady) return;
    
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    console.log(`[📢] User ${userId} left ${groupId}`);
    blacklist.add(userId);
    saveBlacklist();
    leaveStats.set(groupId, leaveStats.get(groupId) || []);
    leaveStats.get(groupId).push({ userId, timestamp: Date.now(), reason: 'left' });
    saveStats();
});

client.on('group_admin_changed', async (notification) => {
    if (!isBotReady) return;
    
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    if (notification.type === 'remove' && userId === OWNER_ID) {
        if (await isBotAdmin(groupId)) {
            await client.addParticipant(groupId, OWNER_ID);
            await client.sendMessage(OWNER_ID, `⚠️ You were removed from ${groupId}!\n✅ Re-added you.${signature}`);
        }
    }
});

// Message handler with detailed debugging
client.on('message_create', async message => {
    try {
        if (!isBotReady) {
            console.log('[⚠️] Bot not ready, ignoring message');
            return;
        }
        
        console.log('=== NEW MESSAGE ===');
        console.log('From:', message.from);
        console.log('Body:', message.body);
        console.log('Author:', message.author);
        console.log('Is Group:', message.from.includes('@g.us'));
        
        if (!message || !message.from) {
            console.log('[⚠️] Invalid message, ignoring.');
            return;
        }

        const userId = message.from.includes('@g.us') ? message.author : message.from;
        console.log('Processed User ID:', userId);
        
        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || "User";
        const content = message.body && typeof message.body === 'string' ? message.body.trim() : '';
        const isGroupMessage = message.from.includes('@g.us');
        const currentGroupId = isGroupMessage ? message.from : groupId;
        const replyTo = isGroupMessage ? currentGroupId : userId;
        const groupName = isGroupMessage ? (groupsMetadata.get(currentGroupId) || "المجموعة") : "";

        console.log(`[📩] Message from ${senderName} (${userId}): ${content || '[non-text]'}`);

        // AI command - ask AI
        if (content.startsWith('!ask ')) {
            const question = content.substring(5).trim();
            if (!question) {
                await client.sendMessage(replyTo, `⚠️ يرجى كتابة سؤال بعد الأمر !ask${signature}`);
                return;
            }
            
            await message.react('🤖');
            await client.sendMessage(replyTo, `🤖 *جاري معالجة سؤالك...*`);
            
            try {
                const aiResponse = await askGemini(question);
                await client.sendMessage(replyTo, `${aiResponse}${signature}`);
            } catch (error) {
                console.error('[❌] Error in AI command:', error);
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء معالجة سؤالك. يرجى المحاولة مرة أخرى لاحقاً.${signature}`);
            }
            return;
        }

        // AI command - analyze intent
        if (content === '!analyze' || content === '!تحليل') {
            if (!isGroupMessage) {
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
                return;
            }
            
            await message.react('🔍');
            await client.sendMessage(replyTo, `🔍 *جاري تحليل الرسائل الأخيرة...*`);
            
            try {
                // Get recent messages
                const chat = await client.getChatById(currentGroupId);
                const messages = await chat.fetchMessages({ limit: 10 });
                
                // Analyze each message
                for (const msg of messages.reverse()) {
                    if (msg.body && !msg.body.startsWith('!')) {
                        const msgContact = await msg.getContact();
                        const msgSenderName = msgContact.pushname || msgContact.name || "User";
                        
                        const analysis = await analyzeUserIntent(msg.body, msgSenderName, true, groupName);
                        
                        if (analysis.confidence > 0.7 && analysis.action !== 'none') {
                            // Take action based on analysis
                            if (analysis.action === 'notify_admin') {
                                await notifyAdmins(currentGroupId, `🔍 *تحليل ذكاء اصطناعي*\n\n${msgSenderName}: ${msg.body}\n\nالنية: ${analysis.intent}\nالرد المقترح: ${analysis.response}`);
                            }
                        }
                    }
                }
                
                await client.sendMessage(replyTo, `✅ *اكتمل تحليل الرسائل!*${signature}`);
            } catch (error) {
                console.error('[❌] Error in analyze command:', error);
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء تحليل الرسائل. يرجى المحاولة مرة أخرى لاحقاً.${signature}`);
            }
            return;
        }

        // AI command - generate content
        if (content.startsWith('!generate ')) {
            const prompt = content.substring(9).trim();
            if (!prompt) {
                await client.sendMessage(replyTo, `⚠️ يرجى كتابة وصف للمحتوى بعد الأمر !generate${signature}`);
                return;
            }
            
            await message.react('✍️');
            await client.sendMessage(replyTo, `✍️ *جاري إنشاء المحتوى...*`);
            
            try {
                const aiResponse = await askGemini(`أنشئ محتوى بناءً على الوصف التالي: ${prompt}`);
                await client.sendMessage(replyTo, `${aiResponse}${signature}`);
            } catch (error) {
                console.error('[❌] Error in generate command:', error);
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء إنشاء المحتوى. يرجى المحاولة مرة أخرى لاحقاً.${signature}`);
            }
            return;
        }

        // Command to generate lectures table PDF
        if (content === '!جدول_المحاضرات' || content === '!lectures_table') {
            await message.react('📊');
            await client.sendMessage(replyTo, `📊 *جاري إنشاء جدول المحاضرات باستخدام pdfmake...*`);
            
            try {
                console.log(`[📊] User requested lectures table. Current lectures count: ${lecturesMetadata.length}`);
                
                if (lecturesMetadata.length === 0) {
                    await client.sendMessage(replyTo, `⚠️ لا توجد محاضرات مضافة بعد!${signature}`);
                    await message.react('❌');
                    return;
                }
                
                const pdfBuffer = await generateLecturesTablePDF(lecturesMetadata);
                
                // Create Media object from buffer
                const media = new MessageMedia(
                    'application/pdf',
                    pdfBuffer.toString('base64'),
                    `جدول_المحاضرات_${new Date().toISOString().split('T')[0]}.pdf`
                );
                
                await client.sendMessage(replyTo, media, {
                    caption: `📊 *جدول المحاضرات*\n\nتم إنشاء الجدول باستخدام pdfmake!\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n📝 عدد المحاضرات: ${lecturesMetadata.length}\n🤖 تم إنشاؤه بواسطة Gemini AI${signature}`
                });
                
                await message.react('✅');
                console.log('[✅] Lectures table sent successfully');
            } catch (error) {
                console.error('[❌] Error generating lectures table:', error);
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء إنشاء جدول المحاضرات: ${error.message}${signature}`);
                await message.react('❌');
            }
            
            return;
        }

        // Pin message command
        if (isGroupMessage && content === '!تثبيت' && message.hasQuotedMsg) {
            if (await isAdmin(userId, currentGroupId)) {
                if (await isBotAdmin(currentGroupId)) {
                    const quotedMsg = await message.getQuotedMessage();
                    await quotedMsg.pin();
                    await client.sendMessage(OWNER_ID, `✅ Pinned message in ${currentGroupId}${signature}`);
                } else {
                    await client.sendMessage(OWNER_ID, `⚠️ I'm not an admin in ${currentGroupId}!${signature}`);
                }
            }
            return;
        }

        // Add PDF command - متاح لجميع أعضاء المجموعة
        if (content === '!اضافة_pdf' || content === '!add pdf') {
            // Check if message is from group
            if (isGroupMessage) {
                await message.react('📄');
                await client.sendMessage(replyTo, `
📄 *إضافة محاضرة PDF*
مرحباً ${senderName}! 🙋‍♂️
يرجى إرسال ملف PDF الآن.
💡 أرسل *إلغاء* للخروج${signature}`);
                userState.set(userId, { step: 'waiting_pdf', timestamp: Date.now() });
            } else {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
            }
            return;
        }

        // Handle PDF upload process
        if (userState.has(userId)) {
            const state = userState.get(userId);

            // Cancel command
            if (content.toLowerCase() === 'إلغاء') {
                await message.react('❌');
                await client.sendMessage(replyTo, `✅ تم الإلغاء!${signature}`);
                userState.delete(userId);
                return;
            }

            // Step 1: Waiting for PDF file
            if (state.step === 'waiting_pdf') {
                if (message.hasMedia && message.type === 'document') {
                    const media = await message.downloadMedia();
                    if (media.mimetype === 'application/pdf') {
                        // Store PDF data in state
                        state.pdfData = {
                            data: media.data,
                            mimetype: media.mimetype,
                            filename: media.filename || 'lecture.pdf'
                        };
                        state.step = 'waiting_pdf_info';
                        userState.set(userId, state);
                        
                        await message.react('✅');
                        await client.sendMessage(replyTo, `
📝 *معلومات المحاضرة*
شكراً ${senderName}! 🙏
يرجى إرسال المعلومات التالية في رسالة واحدة:

📖 *اسم المادة:*
📝 *رقم المحاضرة:*
👨‍🏫 *اسم الأستاذ:*
👥 *رقم الفوج:*

مثال:
📖 اسم المادة: الرياضيات
📝 رقم المحاضرة: 5
👨‍🏫 اسم الأستاذ: أحمد محمد
👥 رقم الفوج: 3

💡 أرسل *إلغاء* للخروج${signature}`);
                    } else {
                        await message.react('⚠️');
                        await client.sendMessage(replyTo, `⚠️ يرجى إرسال ملف PDF فقط!${signature}`);
                    }
                } else {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ يرجى إرسال ملف PDF!${signature}`);
                }
                return;
            }

            // Step 2: Waiting for PDF information
            if (state.step === 'waiting_pdf_info') {
                // Parse information from message
                const info = {};
                const lines = content.split('\n');
                
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.includes('اسم المادة')) {
                        info.subject = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('رقم المحاضرة')) {
                        info.lectureNumber = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('اسم الأستاذ') || trimmedLine.includes('اسم الأساذ')) {
                        info.professor = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('رقم الفوج')) {
                        info.groupNumber = trimmedLine.split(':').slice(1).join(':').trim();
                    }
                }

                // Validate all information is provided
                if (!info.subject || !info.lectureNumber || !info.professor || !info.groupNumber) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ يرجى إرسال جميع المعلومات المطلوبة!${signature}`);
                    return;
                }

                try {
                    // Create media object
                    const media = new MessageMedia(
                        state.pdfData.mimetype,
                        state.pdfData.data,
                        state.pdfData.filename
                    );

                    // Create formatted message
                    const caption = `
📚 *محاضرة جديدة*

📖 *المادة:* ${info.subject}
📝 *رقم المحاضرة:* ${info.lectureNumber}
👨‍🏫 *الأستاذ:* ${info.professor}
👥 *الفوج:* ${info.groupNumber}
👤 *أضيفت بواسطة:* ${senderName}

📅 *تاريخ الإضافة:* ${new Date().toLocaleDateString('ar-EG')}
${signature}`;

                    // Send to PDF archive group
                    await client.sendMessage(PDF_ARCHIVE_GROUP, media, { caption });
                    
                    // Add to lectures metadata
                    lecturesMetadata.push({
                        subject: info.subject,
                        lectureNumber: info.lectureNumber,
                        professor: info.professor,
                        groupNumber: info.groupNumber,
                        date: new Date().toISOString(),
                        addedBy: userId,
                        fileName: state.pdfData.filename
                    });
                    saveLectures();
                    
                    // Send confirmation to user
                    await message.react('✅');
                    await client.sendMessage(replyTo, `
✅ *تمت إضافة المحاضرة بنجاح!*
شكراً ${senderName}! 🙏
تم إرسال الملف والمعلومات إلى مجموعة الأرشيف.${signature}`);

                    // Update lecture statistics
                    lectureStats.set(userId, lectureStats.get(userId) || []);
                    lectureStats.get(userId).push({
                        name: `${info.subject} - محاضرة ${info.lectureNumber}`,
                        timestamp: Date.now()
                    });
                    saveStats();

                    // Clear user state
                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error sending PDF to archive:', error);
                    await message.react('❌');
                    await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء إرسال الملف!${signature}`);
                    userState.delete(userId);
                }
                return;
            }
        }

        // Admin panel
        if (!isGroupMessage && userId === OWNER_ID && content === '!إدارة') {
            await message.react('👨‍💻');
            await client.sendMessage(userId, `
👨‍💻 *لوحة الإدارة*
اختر العملية:
1. إضافة عضو/أعضاء
2. حذف عضو
3. ترقية عضو لمشرف
4. خفض مشرف
5. إضافة مبرمج
6. حذف مبرمج
7. تنظيف المجموعة
8. تثبيت رسالة
9. إحصائيات المجموعات
10. تحفيز المستخدمين
11. تحليل ذكاء اصطناعي
12. إنشاء محتوى
13. جدول المحاضرات (pdfmake)
14. إدارة المحاضرات
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
            userState.set(userId, { step: 'admin_menu', timestamp: Date.now() });
            return;
        }

        // Handle admin panel steps
        if (userState.has(userId) && userId === OWNER_ID) {
            const state = userState.get(userId);

            if (content.toLowerCase() === 'إلغاء') {
                await message.react('❌');
                await client.sendMessage(userId, `✅ تم الإلغاء!${signature}`);
                userState.delete(userId);
                return;
            }

            if (state.step === 'admin_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 14) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح! جرب تاني.${signature}`);
                    return;
                }

                if (option === 8) {
                    await message.react('📌');
                    await client.sendMessage(userId, `
📌 *تثبيت رسالة*
في المجموعة، اعمل ريبلي للرسالة اللي عايز تثبتها واكتب:
!تثبيت
💡 أرسل *إلغاء* لو غيرت رأيك${signature}`);
                    userState.delete(userId);
                    return;
                }

                if (option === 10) {
                    await message.react('🎉');
                    await client.sendMessage(userId, `✅ تم تفعيل التحفيز التلقائي!${signature}`);
                    userState.delete(userId);
                    return;
                }

                if (option === 9) {
                    await message.react('📊');
                    await client.sendMessage(userId, `
📊 *إحصائيات المجموعات*
اختر نوع الإحصائيات:
1. الأعضاء المنضمين
2. الأعضاء اللي غادروا/حُذفوا
3. نشاط الرسايل
4. المحاضرات المضافة
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'stats_menu', timestamp: Date.now() });
                    return;
                }

                if (option === 11) {
                    await message.react('🤖');
                    await client.sendMessage(userId, `
🤖 *تحليل ذكاء اصطناعي*
اختر المجموعة للتحليل:
1. جميع المجموعات
2. مجموعة محددة
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'ai_analysis_select', timestamp: Date.now() });
                    return;
                }

                if (option === 12) {
                    await message.react('✍️');
                    await client.sendMessage(userId, `
✍️ *إنشاء محتوى*
أرسل وصف المحتوى الذي تريد إنشاءه:
💡 أرسل *إلغاء* للخروج${signature}`);
                    userState.set(userId, { step: 'ai_generate_content', timestamp: Date.now() });
                    return;
                }

                if (option === 13) {
                    await message.react('📊');
                    await client.sendMessage(userId, `📊 *جاري إنشاء جدول المحاضرات باستخدام pdfmake...*`);
                    
                    try {
                        console.log(`[📊] Admin requested lectures table. Current lectures count: ${lecturesMetadata.length}`);
                        
                        if (lecturesMetadata.length === 0) {
                            await client.sendMessage(userId, `⚠️ لا توجد محاضرات مضافة بعد!${signature}`);
                            await message.react('❌');
                            userState.delete(userId);
                            return;
                        }
                        
                        const pdfBuffer = await generateLecturesTablePDF(lecturesMetadata);
                        
                        // Create Media object from buffer
                        const media = new MessageMedia(
                            'application/pdf',
                            pdfBuffer.toString('base64'),
                            `جدول_المحاضرات_${new Date().toISOString().split('T')[0]}.pdf`
                        );
                        
                        await client.sendMessage(userId, media, {
                            caption: `📊 *جدول المحاضرات*\n\nتم إنشاء الجدول باستخدام pdfmake!\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n📝 عدد المحاضرات: ${lecturesMetadata.length}\n🤖 تم إنشاؤه بواسطة Gemini AI${signature}`
                        });
                        
                        await message.react('✅');
                        console.log('[✅] Lectures table sent to admin successfully');
                    } catch (error) {
                        console.error('[❌] Error generating lectures table for admin:', error);
                        await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إنشاء جدول المحاضرات: ${error.message}${signature}`);
                        await message.react('❌');
                    }
                    
                    userState.delete(userId);
                    return;
                }

                if (option === 14) {
                    await message.react('📚');
                    await client.sendMessage(userId, `
📚 *إدارة المحاضرات*
اختر العملية:
1. عرض جميع المحاضرات
2. تعديل محاضرة
3. حذف محاضرة
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'lectures_management_menu', timestamp: Date.now() });
                    return;
                }

                await message.react('📋');
                let groupList = `📋 *اختر المجموعة*\n`;
                let index = 1;
                for (const [id, name] of groupsMetadata) {
                    groupList += `${index}. ${name} (${id})\n`;
                    index++;
                }
                groupList += `💡 أرسل رقم المجموعة أو *إلغاء*${signature}`;
                await client.sendMessage(userId, groupList);
                userState.set(userId, { step: `admin_option_${option}_select_group`, timestamp: Date.now() });
                return;
            }

            // Handle lectures management
            if (state.step === 'lectures_management_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 3) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                if (option === 1) {
                    await message.react('📋');
                    let lecturesList = `📋 *جميع المحاضرات*\n\n`;
                    if (lecturesMetadata.length === 0) {
                        lecturesList += `⚠️ لا توجد محاضرات مضافة بعد!\n`;
                    } else {
                        lecturesMetadata.forEach((lecture, index) => {
                            const date = lecture.date ? new Date(lecture.date).toLocaleDateString('ar-EG') : 'غير محدد';
                            lecturesList += `${index + 1}. ${lecture.subject} - محاضرة ${lecture.lectureNumber}\n`;
                            lecturesList += `   👨‍🏫 الأستاذ: ${lecture.professor}\n`;
                            lecturesList += `   👥 الفوج: ${lecture.groupNumber}\n`;
                            lecturesList += `   📅 التاريخ: ${date}\n\n`;
                        });
                    }
                    lecturesList += `💡 إجمالي: ${lecturesMetadata.length} محاضرة${signature}`;
                    await client.sendMessage(userId, lecturesList);
                    userState.delete(userId);
                    return;
                }

                if (option === 2) {
                    await message.react('✏️');
                    let lecturesList = `✏️ *اختر المحاضرة للتعديل*\n\n`;
                    if (lecturesMetadata.length === 0) {
                        lecturesList += `⚠️ لا توجد محاضرات مضافة بعد!\n`;
                    } else {
                        lecturesMetadata.forEach((lecture, index) => {
                            lecturesList += `${index + 1}. ${lecture.subject} - محاضرة ${lecture.lectureNumber}\n`;
                        });
                    }
                    lecturesList += `\n💡 أرسل رقم المحاضرة أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, lecturesList);
                    userState.set(userId, { step: 'edit_lecture_select', timestamp: Date.now() });
                    return;
                }

                if (option === 3) {
                    await message.react('🗑️');
                    let lecturesList = `🗑️ *اختر المحاضرة للحذف*\n\n`;
                    if (lecturesMetadata.length === 0) {
                        lecturesList += `⚠️ لا توجد محاضرات مضافة بعد!\n`;
                    } else {
                        lecturesMetadata.forEach((lecture, index) => {
                            lecturesList += `${index + 1}. ${lecture.subject} - محاضرة ${lecture.lectureNumber}\n`;
                        });
                    }
                    lecturesList += `\n💡 أرسل رقم المحاضرة أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, lecturesList);
                    userState.set(userId, { step: 'delete_lecture_select', timestamp: Date.now() });
                    return;
                }
            }

            // Handle edit lecture
            if (state.step === 'edit_lecture_select') {
                const lectureIndex = parseInt(content) - 1;
                if (isNaN(lectureIndex) || lectureIndex < 0 || lectureIndex >= lecturesMetadata.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم محاضرة غير صحيح!${signature}`);
                    return;
                }

                const lecture = lecturesMetadata[lectureIndex];
                await message.react('✏️');
                await client.sendMessage(userId, `
✏️ *تعديل محاضرة*
المحاضرة الحالية:
📖 المادة: ${lecture.subject}
📝 رقم المحاضرة: ${lecture.lectureNumber}
👨‍🏫 الأستاذ: ${lecture.professor}
👥 الفوج: ${lecture.groupNumber}

أرسل المعلومات الجديدة في رسالة واحدة:

📖 *اسم المادة:*
📝 *رقم المحاضرة:*
👨‍🏫 *اسم الأستاذ:*
👥 *رقم الفوج:*

💡 أرسل *إلغاء* للخروج${signature}`);
                userState.set(userId, { step: 'edit_lecture_data', lectureIndex: lectureIndex, timestamp: Date.now() });
                return;
            }

            if (state.step === 'edit_lecture_data') {
                // Parse information from message
                const info = {};
                const lines = content.split('\n');
                
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.includes('اسم المادة')) {
                        info.subject = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('رقم المحاضرة')) {
                        info.lectureNumber = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('اسم الأستاذ') || trimmedLine.includes('اسم الأساذ')) {
                        info.professor = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('رقم الفوج')) {
                        info.groupNumber = trimmedLine.split(':').slice(1).join(':').trim();
                    }
                }

                // Validate all information is provided
                if (!info.subject || !info.lectureNumber || !info.professor || !info.groupNumber) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال جميع المعلومات المطلوبة!${signature}`);
                    return;
                }

                try {
                    // Update lecture data
                    lecturesMetadata[state.lectureIndex] = {
                        ...lecturesMetadata[state.lectureIndex],
                        subject: info.subject,
                        lectureNumber: info.lectureNumber,
                        professor: info.professor,
                        groupNumber: info.groupNumber
                    };
                    saveLectures();

                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ *تم تعديل المحاضرة بنجاح!*

📖 *المادة:* ${info.subject}
📝 *رقم المحاضرة:* ${info.lectureNumber}
👨‍🏫 *الأستاذ:* ${info.professor}
👥 *الفوج:* ${info.groupNumber}
${signature}`);

                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error editing lecture:', error);
                    await message.react('❌');
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء تعديل المحاضرة!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            // Handle delete lecture
            if (state.step === 'delete_lecture_select') {
                const lectureIndex = parseInt(content) - 1;
                if (isNaN(lectureIndex) || lectureIndex < 0 || lectureIndex >= lecturesMetadata.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم محاضرة غير صحيح!${signature}`);
                    return;
                }

                const lecture = lecturesMetadata[lectureIndex];
                await message.react('🗑️');
                await client.sendMessage(userId, `
🗑️ *تأكيد حذف المحاضرة*

المحاضرة التي سيتم حذفها:
📖 المادة: ${lecture.subject}
📝 رقم المحاضرة: ${lecture.lectureNumber}
👨‍🏫 الأستاذ: ${lecture.professor}
👥 الفوج: ${lecture.groupNumber}

هل أنت متأكد من الحذف؟
أرسل *نعم* للتأكيد أو *لا* للإلغاء${signature}`);
                userState.set(userId, { step: 'delete_lecture_confirm', lectureIndex: lectureIndex, timestamp: Date.now() });
                return;
            }

            if (state.step === 'delete_lecture_confirm') {
                if (content.toLowerCase() === 'نعم') {
                    try {
                        const lecture = lecturesMetadata[state.lectureIndex];
                        lecturesMetadata.splice(state.lectureIndex, 1);
                        saveLectures();

                        await message.react('✅');
                        await client.sendMessage(userId, `
✅ *تم حذف المحاضرة بنجاح!*

تم حذف:
📖 المادة: ${lecture.subject}
📝 رقم المحاضرة: ${lecture.lectureNumber}
👨‍🏫 الأستاذ: ${lecture.professor}
👥 الفوج: ${lecture.groupNumber}
${signature}`);
                    } catch (error) {
                        console.error('[❌] Error deleting lecture:', error);
                        await message.react('❌');
                        await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف المحاضرة!${signature}`);
                    }
                } else {
                    await message.react('❌');
                    await client.sendMessage(userId, `✅ تم إلغاء الحذف!${signature}`);
                }
                userState.delete(userId);
                return;
            }

            // ... باقي كود لوحة التحكم ...
        }

        // Track message statistics
        if (isGroupMessage) {
            if (!messageStats.has(currentGroupId)) {
                messageStats.set(currentGroupId, {});
            }
            const groupStats = messageStats.get(currentGroupId);
            if (!groupStats[userId]) {
                groupStats[userId] = { count: 0, lastMessage: 0 };
            }
            groupStats[userId].count++;
            groupStats[userId].lastMessage = Date.now();
            saveStats();
        }

    } catch (error) {
        console.error('[❌] Error in message handler:', error);
    }
});

client.initialize();