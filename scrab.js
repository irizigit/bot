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
    // إخفاء هوية البوت لكي لا يتم حظره
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        // 1. الدخول للموقع
        await page.goto('https://web.flshbm.ma/', { waitUntil: 'networkidle2', timeout: 45000 });

        // 2. الانتظار حتى تظهر خانة الأبوجي (بالاعتماد على الـ ID الصحيح)
        await page.waitForSelector('#apogee', { timeout: 15000 });

        // 3. إدخال البيانات باستخدام الـ IDs الصحيحة التي اكتشفناها
        await page.type('#apogee', apogee, { delay: 50 });
        await page.type('#cin', cin, { delay: 50 });
        await page.type('#date_naissance', birthDate, { delay: 50 });

        // 4. النقر على الزر (بما أن هناك زراً واحداً فقط سنضغط عليه مباشرة) والانتظار
        await Promise.all([
            page.click('button'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }),
        ]);

        // 5. استخراج النتيجة بعد تسجيل الدخول
        const resultText = await page.evaluate(() => {
            const card = document.querySelector('.card-body') || document.querySelector('main') || document.body;
            return card ? card.innerText.trim() : null;
        });

        await browser.close();
        
        // 6. التحقق من النتيجة
        if (!resultText || resultText.includes("خطأ")) {
            return "❌ المعلومات المدخلة غير صحيحة أو لا يوجد سجل لهذا الطالب.";
        }

        return `✅ *نتائج الفحص:* \n\n${resultText}`;

    } catch (error) {
        console.error('Scraping Error:', error.message);
        await browser.close();
        return `❌ حدث خطأ أثناء الاتصال بالموقع.\nالسبب: ${error.message}`;
    }
}

module.exports = { getStudentInfo };
