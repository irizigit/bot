const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ==========================================
// 1. دالة الدخول للموقع وجلب السكرين شوت حسب الخيار
// ==========================================
async function getStudentData(apogee, cin, birthDate, actionChoice) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 }); 
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // منع تحميل الصور لتسريع التصفح (مع ترك الـ CSS باش تجي الصورة مقادة)
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        if (['image', 'media', 'font'].includes(request.resourceType())) {
            request.abort();
        } else {
            request.continue(); 
        }
    });

    try {
        await page.goto('https://web.flshbm.ma/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('#apogee', { timeout: 20000 });

        await page.type('#apogee', apogee, { delay: 10 });
        await page.type('#cin', cin, { delay: 10 });
        await page.type('#date_naissance', birthDate, { delay: 10 });

        await Promise.all([
            page.click('button'),
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
        ]);

        await new Promise(r => setTimeout(r, 2000));

        const isError = await page.evaluate(() => {
            return document.body.innerText.includes('خطأ') || document.body.innerText.includes('incorrectes');
        });

        if (isError) {
            await browser.close();
            return { success: false, text: "❌ المعلومات المدخلة غير صحيحة." };
        }

        // 🎯 تحديد الزر اللي غيكليكي عليه بناءً على اختيار المستخدم
        const clicked = await page.evaluate((choice) => {
            const elements = Array.from(document.querySelectorAll('a, button, div.card'));
            let targetWord = '';
            
            if (choice === '1') targetWord = 'Résultats';          // النقط
            else if (choice === '2') targetWord = 'Calendrier';    // الامتحانات
            else if (choice === '3') targetWord = 'Affichage';     // الإعلانات
            else if (choice === '4') targetWord = 'Absence';       // الغياب

            const targetBtn = elements.find(el => el.innerText && el.innerText.includes(targetWord));
            if (targetBtn) {
                targetBtn.click();
                return true;
            }
            return false;
        }, actionChoice);

        if (!clicked) {
            await browser.close();
            return { success: false, text: "❌ لم أتمكن من العثور على هذا القسم في الموقع حالياً." };
        }

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => console.log("AJAX Load"));
        await new Promise(r => setTimeout(r, 4000)); 

        const screenshotPath = path.join(__dirname, `data_${apogee}_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        await browser.close();
        return { success: true, path: screenshotPath };

    } catch (error) {
        console.error('Scraping Error:', error.message);
        await browser.close();
        return { success: false, text: `❌ حدث خطأ أثناء جلب البيانات: ${error.message}` };
    }
}

// ==========================================
// 2. دالة استقبال الأمر (!فحص) وعرض القائمة
// ==========================================
async function handleStudentCommand(content, message, sendReply, updateState, userIdRaw, replyTo, signature) {
    const args = content.split(' ').slice(1);
    
    if (args.length < 3) {
        return sendReply(`⚠️ *طريقة الاستخدام:* \n!فحص [رقم_الأبوجي] [CIN] [تاريخ_الميلاد]\n\n💡 مثال:\n!فحص 21004455 AB123456 2005-12-14${signature}`);
    }

    let apogee = "", cin = "", birth = "";

    args.forEach(arg => {
        if (arg.includes('-') || arg.includes('/')) {
            birth = arg;
        } else if (/^[a-zA-Z]/.test(arg)) {
            cin = arg.toUpperCase();
        } else if (/^\d+$/.test(arg)) {
            apogee = arg;
        }
    });

    if (!apogee || !cin || !birth) {
         return sendReply(`⚠️ *تأكد من إدخال المعلومات بشكل صحيح:* \n- رقم الأبوجي (أرقام فقط)\n- رقم البطاقة الوطنية (حروف وأرقام)\n- تاريخ الازدياد (YYYY-MM-DD)${signature}`);
    }
    
    // حفظ المعلومات في الذاكرة المؤقتة (State) باش نخدمو بيها من بعد
    updateState(userIdRaw, replyTo, { 
        step: 'student_menu_choice', 
        credentials: { apogee, cin, birth } 
    });

    // إرسال القائمة للمستخدم
    const menuMsg = `✅ *تم حفظ معلوماتك بنجاح!*\n━━━━━━━━━━━━━━━━━━\n\nشنو بغيتي تشوف؟ (أرسل رقم الخيار):\n\n1️⃣ 📊 النقط والنتائج (Résultats)\n2️⃣ 📅 جدول الامتحانات / الاستدعاء\n3️⃣ 📌 سبورة الإعلانات (Affichage)\n4️⃣ 📝 تبرير الغياب (Absence)\n\n💡 _أرسل "إلغاء" للخروج من هذه القائمة._${signature}`;
    
    await sendReply(menuMsg);
}

// ==========================================
// 3. دالة معالجة اختيار المستخدم من القائمة
// ==========================================
async function processStudentChoice(content, message, sendReply, state, clearState, userIdRaw, MessageMedia, signature) {
    const choice = content.trim();
    
    if (!['1', '2', '3', '4'].includes(choice)) {
        return sendReply(`⚠️ *خيار غير صحيح!* يرجى إرسال رقم من 1 إلى 4.${signature}`);
    }

    await message.react('⏳');
    await sendReply('⏳ *جاري الاتصال بالموقع وجلب البيانات المطلوبة...* 🚀');

    // استرجاع المعلومات من الذاكرة
    const { apogee, cin, birth } = state.credentials;

    try {
        const result = await getStudentData(apogee, cin, birth, choice);
        
        if (result.success && result.path) {
            const media = MessageMedia.fromFilePath(result.path);
            
            let captionText = "✅ *تمت العملية بنجاح!* تفضل البيانات المطلوبة:";
            if(choice === '1') captionText = "📊 *إليك النقط والنتائج الخاصة بك:*";
            if(choice === '2') captionText = "📅 *إليك جدول الامتحانات / الاستدعاء:*";
            
            await sendReply(media, { caption: `${captionText}${signature}` });
            await message.react('✅');
            
            if (fs.existsSync(result.path)) {
                fs.unlinkSync(result.path);
            }
        } else {
            await sendReply(result.text + signature);
            await message.react('❌');
        }
    } catch (err) {
        await sendReply("❌ وقع مشكل تقني داخلي أثناء معالجة الطلب." + signature);
        await message.react('❌');
    }
    
    // مسح الحالة بعد الانتهاء
    clearState(userIdRaw);
}

module.exports = { handleStudentCommand, processStudentChoice };
