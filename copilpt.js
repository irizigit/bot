const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const client = new Client({ 
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const userState = new Map();
let groupId = null; // معرف المجموعة الافتراضي
let requestCount = 0;

const lecturesDir = 'C:\\Users\\IRIZI\\Desktop\\wha';
const metadataPath = path.join(lecturesDir, 'metadata.json');
const signature = "\n\n👨‍💻 *dev by: IRIZI 😊*";

// رقمك الشخصي المسموح له بالتحكم في المجموعة من المحادثة الخاصة
const allowedUser = '212621957775@c.us';

// إذا ما كان موجود، أنشئ ملف metadata
if (!fs.existsSync(metadataPath)) fs.writeFileSync(metadataPath, JSON.stringify({}));

// تحميل البيانات الوصفية
function loadMetadata() {
    return JSON.parse(fs.readFileSync(metadataPath));
}

// حفظ البيانات الوصفية
function saveMetadata(data) {
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2));
}

// دالة لإرسال إشعار للمشرفين
async function notifyAdmins(groupId, text) {
    try {
        const chat = await client.getChatById(groupId);
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        for (const admin of admins) {
            await client.sendMessage(admin.id._serialized, text);
        }
    } catch (error) {
        console.error('❌ خطأ أثناء إرسال إشعار للمشرفين:', error);
    }
}

// دالة للحصول على اسم ملف فريد
function getUniqueFilename(basePath, filename) {
    let newFilename = filename;
    let counter = 1;
    const ext = path.extname(filename).toLowerCase() || '.pdf';
    const nameWithoutExt = path.basename(filename, ext);

    while (fs.existsSync(path.join(basePath, newFilename))) {
        newFilename = `${nameWithoutExt}_${counter}${ext}`;
        counter++;
    }
    return newFilename;
}

client.on('qr', qr => {
    console.log('📸 امسح رمز QR لتسجيل الدخول:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ العميل جاهز ومتصل!');
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup);
        if (group) {
            groupId = group.id._serialized;
            console.log(`[ℹ️] تم تحديد المجموعة الافتراضية: ${groupId}`);
        } else {
            console.log('[⚠️] لم يتم العثور على أي مجموعة بعد.');
        }
    } catch (error) {
        console.error('❌ خطأ أثناء جلب المجموعات في حدث ready:', error);
    }
});

client.on('group_join', (notification) => {
    groupId = notification.chatId;
    console.log(`[📢] انضم البوت إلى المجموعة: ${groupId}`);
});

async function isAdmin(userId, groupId) {
    try {
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) return false;

        if (!chat.participants) {
            await chat.fetchParticipants();
        }

        const admins = chat.participants?.filter(p => p.isAdmin || p.isSuperAdmin) || [];
        return admins.some(admin => admin.id._serialized === userId);
    } catch (error) {
        console.error('❌ خطأ أثناء التحقق من حالة المشرف:', error);
        return false;
    }
}

async function isBotAdmin(groupId) {
    try {
        const chat = await client.getChatById(groupId);
        const botId = client.info.wid._serialized;
        const admins = chat.participants?.filter(p => p.isAdmin || p.isSuperAdmin) || [];
        return admins.some(admin => admin.id._serialized === botId);
    } catch (error) {
        console.error('❌ خطأ أثناء التحقق من حالة البوت كمشرف:', error);
        return false;
    }
}

function getLecturesList() {
    return fs.readdirSync(lecturesDir).filter(file => file.toLowerCase().endsWith('.pdf'));
}

cron.schedule('0 22 * * *', async () => {
    if (!groupId) {
        console.log('[⚠️] لا يوجد groupId متاح لإغلاق المجموعة.');
        return;
    }
    try {
        const chat = await client.getChatById(groupId);
        if (await isBotAdmin(groupId)) {
            await chat.setMessagesAdminsOnly(true);
            await client.sendMessage(groupId, '🚫 تم إغلاق المجموعة تلقائيًا الساعة 10:00 مساءً.' + signature);
            console.log('[✅] تم إغلاق المجموعة بنجاح عبر cron.');
        } else {
            console.log('[⚠️] البوت ليس مشرفًا، لا يمكنه إغلاق المجموعة تلقائيًا.');
        }
    } catch (error) {
        console.error('[❌] خطأ أثناء إغلاق المجموعة عبر cron:', error);
    }
});

cron.schedule('0 8 * * *', async () => {
    if (!groupId) {
        console.log('[⚠️] لا يوجد groupId متاح لفتح المجموعة.');
        return;
    }
    try {
        const chat = await client.getChatById(groupId);
        if (await isBotAdmin(groupId)) {
            await chat.setMessagesAdminsOnly(false);
            await client.sendMessage(groupId, '✅ تم فتح المجموعة تلقائيًا الساعة 8:00 صباحًا.' + signature);
            console.log('[✅] تم فتح المجموعة بنجاح عبر cron.');
        } else {
            console.log('[⚠️] البوت ليس مشرفًا، لا يمكنه فتح المجموعة تلقائيًا.');
        }
    } catch (error) {
        console.error('[❌] خطأ أثناء فتح المجموعة عبر cron:', error);
    }
});

client.on('message_create', async message => {
    try {
        const userId = message.from.includes('@g.us') ? message.author : message.from;
        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || "مستخدم";
        const content = message.body.trim();
        const isGroupMessage = message.from.includes('@g.us');
        const currentGroupId = isGroupMessage ? message.from : groupId;

        console.log(`[📩] رسالة من ${senderName} (${userId}): ${content}, حالة المجموعة في WhatsApp: ${currentGroupId ? ((await client.getChatById(currentGroupId)).isReadOnly ? 'مغلقة' : 'مفتوحة') : 'غير محددة'}`);

        const metadata = loadMetadata();

        // التحكم في المجموعة من المحادثة الخاصة (لك فقط)
        if (!isGroupMessage && userId === allowedUser) {
            if (content.toLowerCase() === 'إغلاق المجموعة') {
                if (!currentGroupId) {
                    console.log(`[⚠️] لا يوجد groupId متاح لإغلاق المجموعة.`);
                    await message.reply(`⚠️ لم يتم تحديد المجموعة بعد. تأكد أن البوت في المجموعة المطلوبة، يا ${senderName}!` + signature);
                    return;
                }

                if (await isBotAdmin(currentGroupId)) {
                    const chat = await client.getChatById(currentGroupId);
                    if (chat.isReadOnly) {
                        await message.reply(`⚠️ المجموعة مغلقة بالفعل، يا ${senderName}.` + signature);
                    } else {
                        await chat.setMessagesAdminsOnly(true);
                        await message.reply(`🚫 تم إغلاق المجموعة بواسطة ${senderName}!` + signature);
                        console.log(`[🔒] تم إغلاق المجموعة يدويًا بواسطة ${senderName} (${userId}) من المحادثة الخاصة.`);
                    }
                } else {
                    console.log(`[⚠️] البوت ليس مشرفًا في المجموعة ${currentGroupId}، لا يمكنه إغلاق المجموعة.`);
                    await message.reply(`⚠️ أنا لست مشرفًا في المجموعة، لا أستطيع إغلاقها. ارفعني إلى مشرف أولاً، يا ${senderName}!` + signature);
                }
                return;
            }

            if (content.toLowerCase() === 'فتح المجموعة') {
                if (!currentGroupId) {
                    console.log(`[⚠️] لا يوجد groupId متاح لفتح المجموعة.`);
                    await message.reply(`⚠️ لم يتم تحديد المجموعة بعد. تأكد أن البوت في المجموعة المطلوبة، يا ${senderName}!` + signature);
                    return;
                }

                if (await isBotAdmin(currentGroupId)) {
                    const chat = await client.getChatById(currentGroupId);
                    if (!chat.isReadOnly) {
                        await message.reply(`⚠️ المجموعة مفتوحة بالفعل، يا ${senderName}.` + signature);
                    } else {
                        await chat.setMessagesAdminsOnly(false);
                        await message.reply(`✅ تم فتح المجموعة بواسطة ${senderName}!` + signature);
                        console.log(`[🔓] تم فتح المجموعة يدويًا بواسطة ${senderName} (${userId}) من المحادثة الخاصة.`);
                    }
                } else {
                    console.log(`[⚠️] البوت ليس مشرفًا في المجموعة ${currentGroupId}، لا يمكنه فتح المجموعة.`);
                    await message.reply(`⚠️ أنا لست مشرفًا في المجموعة، لا أستطيع فتحها. ارفعني إلى مشرف أولاً، يا ${senderName}!` + signature);
                }
                return;
            }
        }

        // إذا لم يكن المرسل هو المستخدم المسموح له وأرسل الأمر من المحادثة الخاصة
        if (!isGroupMessage && userId !== allowedUser) {
            if (content.toLowerCase() === 'إغلاق المجموعة' || content.toLowerCase() === 'فتح المجموعة') {
                console.log(`[🚫] رفض أمر من ${senderName} (${userId}) لأنه ليس المستخدم المسموح له.`);
                await message.reply(`❌ عذرًا ${senderName}، لا يمكنك التحكم في المجموعة من هنا. هذا الأمر مخصص للمطور فقط!` + signature);
                return;
            }
        }

        // باقي الوظائف (تعمل داخل المجموعة فقط)
        if (isGroupMessage && currentGroupId) {
            const chat = await client.getChatById(currentGroupId);
            const isGroupClosed = chat.isReadOnly;
            if (isGroupClosed) {
                const isUserAdmin = await isAdmin(userId, currentGroupId);
                const allowedCommands = ['إغلاق المجموعة', 'فتح المجموعة'];

                if (!allowedCommands.includes(content.toLowerCase()) || !isUserAdmin) {
                    console.log(`[🚫] تجاهل رسالة من ${senderName} لأن المجموعة مغلقة وليس لديه صلاحية.`);
                    return;
                }
            }

            if (content.toLowerCase() === 'الأوامر' || content.toLowerCase() === '!help') {
                const helpMessage = `
📋 *قائمة الأوامر المتاحة:*
- *pdf*: لعرض قائمة المحاضرات المتاحة.
- *pdf فئة [اسم الفئة]*: لعرض المحاضرات في فئة معينة.
- *ابحث [كلمة]*: للبحث عن محاضرات بالاسم أو الوصف.
- *الإحصائيات*: لعرض إحصائيات البوت.
- *لإضافة محاضرة*: أرسل ملف PDF مع وصف (مثال: "رياضيات: وصف المحاضرة").
✨ أي استفسار؟ تواصلوا مع المشرفين! ${signature}`;
                await message.reply(helpMessage);
                return;
            }

            if (message.hasMedia && message.type === 'document' && content) {
                console.log(`[📎] استُقبل ملف: filename=${message.filename}, mimetype=${message.mimetype}, type=${message.type}, content=${content}`);
                const isPdf = message.mimetype && (message.mimetype.includes('application/pdf') || message.mimetype.includes('application/octet-stream'));
                const hasPdfExtension = message.filename && message.filename.toLowerCase().endsWith('.pdf');
                const contentHasPdfExtension = content.toLowerCase().endsWith('.pdf');

                let inferredFilename = message.filename;
                if (!message.filename && contentHasPdfExtension) {
                    inferredFilename = content;
                    console.log(`[⚠️] تحذير: filename=undefined، يتم استخدام content كاسم الملف: ${inferredFilename}`);
                }

                if (!isPdf && !hasPdfExtension && !contentHasPdfExtension) {
                    console.log(`[❌] الملف ليس PDF: mimetype=${message.mimetype}, filename=${message.filename}, content=${content}`);
                    await message.reply(`❌ يرجى إرسال ملف PDF فقط، يا ${senderName}!` + signature);
                    return;
                }

                if (!isPdf && (hasPdfExtension || contentHasPdfExtension)) {
                    console.log(`[⚠️] تحذير: mimetype=${message.mimetype} غير قياسي، ولكن الامتداد PDF مقبول (filename=${inferredFilename || content}).`);
                }

                const media = await message.downloadMedia();
                let filename = inferredFilename || `lecture_${Date.now()}.pdf`;
                filename = filename.replace(/[^a-zA-Z0-9\u0600-\u06FF\s._-]/g, '').trim();
                if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';

                filename = getUniqueFilename(lecturesDir, filename);
                const filePath = path.join(lecturesDir, filename);

                fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

                const [category, ...descriptionParts] = content.split(':');
                const description = descriptionParts.join(':').trim() || content;

                metadata[filename] = {
                    name: inferredFilename || filename,
                    description: description,
                    category: category.trim() || 'عام'
                };
                saveMetadata(metadata);

                await message.reply(`✅ تم حفظ المحاضرة *${filename}* في فئة *${metadata[filename].category}*!` + signature);
                await notifyAdmins(currentGroupId, `📢 تمت إضافة محاضرة جديدة: *${filename}* بواسطة ${senderName}`);
                return;
            }

            if (content.toLowerCase() === 'pdf') {
                const lectures = getLecturesList();
                if (lectures.length === 0) {
                    await message.reply(`📂 لا توجد محاضرات حالياً، يا ${senderName}.` + signature);
                    return;
                }

                let lectureList = '📚 قائمة المحاضرات:\n';
                lectures.forEach((lecture, index) => {
                    const title = metadata[lecture]?.name || lecture;
                    lectureList += `${index + 1}. ${title} (${metadata[lecture]?.category || 'عام'})\n`;
                });
                lectureList += `\n✉️ أرسل رقم المحاضرة اللي تبيها يا ${senderName} (مثال: 1)`;

                userState.set(userId, { step: 'select_lecture', lectures });
                await message.reply(lectureList + signature);
                return;
            }

            if (content.toLowerCase().startsWith('pdf فئة ')) {
                const category = content.slice(8).trim();
                const lectures = getLecturesList();
                const filteredLectures = lectures.filter(lecture => metadata[lecture]?.category === category);

                if (filteredLectures.length === 0) {
                    await message.reply(`📂 لا توجد محاضرات في فئة *${category}*، يا ${senderName}.` + signature);
                    return;
                }

                let lectureList = `📚 المحاضرات في فئة *${category}*:\n`;
                filteredLectures.forEach((lecture, index) => {
                    const title = metadata[lecture]?.name || lecture;
                    lectureList += `${index + 1}. ${title}\n`;
                });
                lectureList += `\n✉️ أرسل رقم المحاضرة اللي تبيها يا ${senderName} (مثال: 1)`;

                userState.set(userId, { step: 'select_lecture', lectures: filteredLectures });
                await message.reply(lectureList + signature);
                return;
            }

            if (content.toLowerCase().startsWith('ابحث ')) {
                const query = content.slice(5).trim().toLowerCase();
                const lectures = getLecturesList();
                const filteredLectures = lectures.filter(lecture =>
                    metadata[lecture]?.name.toLowerCase().includes(query) ||
                    metadata[lecture]?.description.toLowerCase().includes(query)
                );

                if (filteredLectures.length === 0) {
                    await message.reply(`📂 لم يتم العثور على محاضرات مطابقة لـ *${query}*، يا ${senderName}.` + signature);
                    return;
                }

                let lectureList = `📚 نتائج البحث عن *${query}*:\n`;
                filteredLectures.forEach((lecture, index) => {
                    const title = metadata[lecture]?.name || lecture;
                    lectureList += `${index + 1}. ${title} (${metadata[lecture]?.category || 'عام'})\n`;
                });
                lectureList += `\n✉️ أرسل رقم المحاضرة اللي تبيها يا ${senderName} (مثال: 1)`;

                userState.set(userId, { step: 'select_lecture', lectures: filteredLectures });
                await message.reply(lectureList + signature);
                return;
            }

            if (content.toLowerCase() === 'الإحصائيات') {
                const lectures = getLecturesList();
                const chat = await client.getChatById(currentGroupId);
                const statsMessage = `
📊 *إحصائيات البوت:*
- عدد المحاضرات: ${lectures.length}
- عدد الطلبات: ${requestCount}
- حالة المجموعة: ${chat.isReadOnly ? 'مغلقة 🚫' : 'مفتوحة ✅'}
${signature}`;
                await message.reply(statsMessage);
                return;
            }

            if (userState.has(userId)) {
                const state = userState.get(userId);
                if (state.step === 'select_lecture') {
                    const lectureIndex = parseInt(content) - 1;
                    if (lectureIndex >= 0 && lectureIndex < state.lectures.length) {
                        const selectedLecture = state.lectures[lectureIndex];
                        const pdfPath = path.join(lecturesDir, selectedLecture);

                        if (fs.existsSync(pdfPath)) {
                            requestCount++;
                            const media = MessageMedia.fromFilePath(pdfPath);
                            const description = metadata[selectedLecture]?.description || 'بدون وصف';
                            const category = metadata[selectedLecture]?.category || 'عام';

                            await client.sendMessage(userId, media, {
                                caption: `📎 المحاضرة: ${metadata[selectedLecture]?.name || selectedLecture}\n📝 الوصف: ${description}\n📚 الفئة: ${category}${signature}`
                            });
                        } else {
                            await message.reply(`❌ الملف غير موجود، يا ${senderName}.` + signature);
                        }
                        userState.delete(userId);
                    } else {
                        await message.reply(`⚠️ رقم غير صحيح يا ${senderName}! حاول مرة ثانية.` + signature);
                    }
                }
            }
        }

    } catch (error) {
        console.error(`❌ خطأ في معالجة الرسالة من ${message.from}:`, error);
        const userId = message.from.includes('@g.us') ? message.author : message.from;
        const isGroupMessage = message.from.includes('@g.us');
        const currentGroupId = isGroupMessage ? message.from : groupId;

        if (isGroupMessage && currentGroupId) {
            const chat = await client.getChatById(currentGroupId);
            if (chat.isReadOnly) {
                console.log(`[ℹ️] تجاهل إرسال رسالة خطأ في المجموعة المغلقة لـ ${userId}.`);
                await client.sendMessage(userId, `⚠️ حدث خطأ، حاول مرة أخرى لاحقًا! ${signature}`);
            } else {
                await message.reply(`⚠️ حدث خطأ، حاول مرة أخرى لاحقًا! ${signature}`);
            }
        } else {
            await message.reply(`⚠️ حدث خطأ، حاول مرة أخرى لاحقًا! ${signature}`);
        }
    }
});


client.initialize()
    .then(() => console.log('🚀 تم تشغيل البوت بنجاح!'))
    .catch(err => console.error('❌ خطأ أثناء التشغيل:', err));