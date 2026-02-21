const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

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
    // درنا شاشة عريضة باش السكرين شوت يجي فيها الجدول كامل
    await page.setViewport({ width: 1280, height: 1024 }); 
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // تسريع المتصفح مع السماح لـ CSS باش يجي الجدول مقاد
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

        // التأكد من أن الدخول نجح
        const isError = await page.evaluate(() => {
            return document.body.innerText.includes('خطأ') || document.body.innerText.includes('incorrectes');
        });

        if (isError) {
            await browser.close();
            return { success: false, text: "❌ المعلومات المدخلة غير صحيحة." };
        }

        // 🎯 البحث عن زر "Résultats" والضغط عليه
        const clicked = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('a, button, div.card'));
            // كنقلبو على أي حاجة مكتوب فيها Résultats
            const resBtn = elements.find(el => el.innerText && el.innerText.includes('Résultats'));
            if (resBtn) {
                resBtn.click();
                return true;
            }
            return false;
        });

        if (!clicked) {
            await browser.close();
            return { success: false, text: "❌ تم الدخول بنجاح، لكن لم أتمكن من العثور على قسم 'النتائج'." };
        }

        // انتظار تحميل صفحة النقط
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => console.log("AJAX Load"));
        await new Promise(r => setTimeout(r, 4000)); // نتسناو الجدول يترسم مزيان

        // 📸 أخذ سكرين شوت للصفحة ديال النقط
        const screenshotPath = path.join(__dirname, `results_${apogee}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        await browser.close();
        return { success: true, path: screenshotPath };

    } catch (error) {
        console.error('Scraping Error:', error.message);
        await browser.close();
        return { success: false, text: `❌ حدث خطأ أثناء جلب النتائج: ${error.message}` };
    }
}

module.exports = { getStudentInfo };
