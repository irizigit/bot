const puppeteer = require('puppeteer');

async function getStudentInfo(apogee, cin, birthDate) {
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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 🚀 ميزة تسريع التصفح: منع تحميل الصور والملفات الثقيلة (CSS/Fonts)
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
            request.abort(); // حبس هاد الملفات باش الموقع يزرب
        } else {
            request.continue(); // خلي غير النصوص والسكربتات الضرورية
        }
    });

    try {
        // الدخول للموقع بسرعة (domcontentloaded أسرع بكثير من networkidle2)
        // زدنا الوقت لـ 60 ثانية كحد أقصى للحيطة والحذر
        await page.goto('https://web.flshbm.ma/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // الانتظار حتى تظهر خانة الأبوجي
        await page.waitForSelector('#apogee', { timeout: 20000 });

        // إدخال البيانات
        await page.type('#apogee', apogee, { delay: 30 });
        await page.type('#cin', cin, { delay: 30 });
        await page.type('#date_naissance', birthDate, { delay: 30 });

        // النقر على الزر والانتظار حتى تحميل صفحة النتيجة بسرعة
        await Promise.all([
            page.click('button'),
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => console.log("تجاوزنا وقت الانتظار، جاري الفحص..."))
        ]);

        // انتظار إضافي خفيف للتأكد أن النتيجة ظهرت
        await new Promise(r => setTimeout(r, 2000));

        // استخراج النتيجة
        const resultText = await page.evaluate(() => {
            const card = document.querySelector('.card-body') || document.querySelector('main') || document.body;
            // كنحاولو نمسحو الفراغات الزايدة باش يجي الميساج نقي
            return card ? card.innerText.trim().replace(/\n{3,}/g, '\n\n') : null;
        });

        await browser.close();
        
        if (!resultText || resultText.includes("خطأ")) {
            return "❌ المعلومات المدخلة غير صحيحة، أو لا يوجد سجل لهذا الطالب.";
        }

        return `✅ *نتائج الفحص:* \n\n${resultText}`;

    } catch (error) {
        console.error('Scraping Error:', error.message);
        await browser.close();
        
        // رسالة الخطأ للمستخدم
        return `❌ حدث خطأ بسبب بطء أو توقف موقع الكلية.\n(السبب: ${error.message})`;
    }
}

module.exports = { getStudentInfo };
