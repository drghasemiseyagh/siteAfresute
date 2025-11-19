require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { setGlobalDispatcher, ProxyAgent } = require("undici");

// تنظیم پروکسی اگر در .env فعال باشد
if (process.env.USE_PROXY === 'true') {
    const proxyUrl = 'http://mtqggzas:25otjuhepz57@142.111.48.253:7030';
    const dispatcher = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(dispatcher);
    console.log('پروکسی برای جمینای فعال شد.');
}

// بررسی وجود کلید API
if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_API_KEY_HERE') {
    console.error('خطا: لطفا کلید API جمینای خود را در فایل .env وارد کنید.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function run() {
    // تشخیص محیط GitHub Actions
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    const headlessMode = isGitHubActions ? true : false;
    
    console.log(`محیط اجرا: ${isGitHubActions ? 'GitHub Actions' : 'Local'}`);
    console.log(`حالت مرورگر: ${headlessMode ? 'Headless' : 'Visible'}`);
    
    const browser = await chromium.launch({ headless: headlessMode });
    const context = await browser.newContext();

    // 1. خواندن و تنظیم کوکی‌ها
    try {
        const cookiesString = fs.readFileSync('cookies.json', 'utf8');
        const cookies = JSON.parse(cookiesString).map(cookie => {
            // Playwright doesn't accept null for sameSite, defaulting to Lax
            if (cookie.sameSite === null) cookie.sameSite = "Lax";
            return cookie;
        });
        await context.addCookies(cookies);
        console.log('کوکی‌ها با موفقیت بارگذاری شدند.');
    } catch (error) {
        console.error('خطا در خواندن فایل cookies.json:', error);
        return;
    }

    const page = await context.newPage();

    // 2. ورود به سایت اصلی
    console.log('در حال رفتن به صفحه اصلی...');
    await page.goto('https://www.you-cubez.com/', { waitUntil: 'domcontentloaded' });
    // await page.reload(); // حذف شد چون ممکن است باعث خطا شود

    // 3. رفتن به صفحه تبلیغات
    console.log('در حال رفتن به صفحه تبلیغات...');
    await page.goto('https://www.you-cubez.com/ptc_ads.php', { waitUntil: 'domcontentloaded' });

    // حلقه اصلی برای پردازش تبلیغات
    await processAds(page, context);
    
    console.log('عملیات تا این مرحله انجام شد. مرورگر بسته می‌شود.');
    await browser.close();
}

// تابع اصلی پردازش تبلیغات
async function processAds(mainPage, context) {
    let adCount = 0;
    
    while (true) {
        console.log(`\n--- بررسی تبلیغ شماره ${adCount + 1} ---`);
        
        // بررسی وجود تبلیغ
        const adLink = mainPage.locator('.thumb-info-content a').first();
        const adExists = await adLink.count() > 0;
        
        if (!adExists) {
            console.log('✓ تمام تبلیغات پردازش شدند!');
            break;
        }
        
        console.log('تبلیغ پیدا شد. در حال کلیک...');
        
        // کلیک روی تبلیغ و باز کردن تب جدید
        const adPromise = context.waitForEvent('page');
        await adLink.click();
        const adPage = await adPromise;
        await adPage.waitForLoadState('domcontentloaded');
        console.log('تب جدید باز شد.');
        
        // پردازش صفحه تبلیغ (کپچا یا bot check)
        const success = await handleAdPage(adPage);
        
        if (success) {
            console.log('✓ تبلیغ با موفقیت پردازش شد.');
            adCount++;
        } else {
            console.log('✗ خطا در پردازش تبلیغ.');
        }
        
        // بستن تب تبلیغ
        console.log('در حال بستن تب تبلیغ...');
        await adPage.close();
        
        // رفرش صفحه اصلی
        console.log('در حال رفرش صفحه اصلی...');
        await mainPage.reload({ waitUntil: 'domcontentloaded' });
        await mainPage.waitForTimeout(2000); // صبر 2 ثانیه بعد از رفرش
    }
    
    console.log(`\n🎉 کل تبلیغات پردازش شده: ${adCount}`);
}

// تابع پردازش صفحه تبلیغ (کپچا یا bot check)
async function handleAdPage(adPage) {
    try {
        // مرحله 1: چک کردن کپچا یا bot check
        const captchaExists = await adPage.locator('img[src*="captcha.php"]').count() > 0;
        const botCheckExists = await adPage.locator('input[name="submit"][value*="REAL"]').count() > 0;
        
        if (captchaExists) {
            console.log('→ کپچا شناسایی شد.');
            const captchaResolved = await handleCaptcha(adPage);
            if (!captchaResolved) return false;
        } else if (botCheckExists) {
            console.log('→ دکمه "I am REAL!" شناسایی شد.');
            await adPage.click('input[name="submit"][value*="REAL"]');
            await adPage.waitForLoadState('domcontentloaded');
            console.log('✓ دکمه "I am REAL!" کلیک شد.');
        } else {
            console.log('→ کپچا یا bot check یافت نشد. ادامه...');
        }
        
        // مرحله 2: منتظر ماندن برای دکمه "Click Me Now!"
        console.log('در حال انتظار برای دکمه "Click Me Now!"...');
        
        try {
            // منتظر ظاهر شدن دکمه (حداکثر 45 ثانیه)
            await adPage.waitForSelector('input[name="submit_com"].button', { 
                timeout: 45000,
                state: 'visible'
            });
            
            console.log('✓ دکمه "Click Me Now!" ظاهر شد.');
            
            // صبر 2-3 ثانیه قبل از کلیک
            await adPage.waitForTimeout(2500);
            
            // کلیک روی دکمه
            await adPage.click('input[name="submit_com"].button');
            console.log('✓ دکمه "Click Me Now!" کلیک شد.');
            
            // صبر 5 ثانیه بعد از کلیک
            await adPage.waitForTimeout(5000);
            
            return true;
        } catch (e) {
            console.log('✗ دکمه "Click Me Now!" ظاهر نشد (Timeout).');
            return false;
        }
    } catch (error) {
        console.error('خطا در پردازش صفحه تبلیغ:', error.message);
        return false;
    }
}

// تابع جداگانه برای حل کپچا
async function handleCaptcha(adPage) {
    try {
        const captchaElement = adPage.locator('img[src*="captcha.php"]');
        
        console.log('در حال عکس گرفتن از کپچا...');
        const captchaPath = 'captcha.png';
        await captchaElement.screenshot({ path: captchaPath });
        
        console.log('در حال ارسال به جمینای...');
        const captchaText = await solveCaptchaWithGemini(captchaPath);
        
        if (!captchaText) {
            console.log('✗ جمینای نتوانست کپچا را حل کند.');
            return false;
        }
        
        console.log('متن دریافتی از جمینای:', captchaText);
        const cleanText = captchaText.replace(/[^a-zA-Z0-9]/g, '');
        console.log('متن تمیز شده:', cleanText);
        
        // تایپ و سابمیت کپچا
        await adPage.fill('input[name="Code"]', cleanText);
        await adPage.click('input[name="submit"]');
        await adPage.waitForLoadState('domcontentloaded');
        
        console.log('✓ کپچا ارسال شد.');
        return true;
    } catch (error) {
        console.error('خطا در حل کپچا:', error.message);
        return false;
    }
}

async function solveCaptchaWithGemini(imagePath) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const imageBuffer = fs.readFileSync(imagePath);
        const imageBase64 = imageBuffer.toString('base64');

        const prompt = "Strictly output ONLY the alphanumeric text found in this CAPTCHA image. No introductions, no explanations, no markdown, no spaces. Just the raw characters.";

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: imageBase64,
                    mimeType: "image/png",
                },
            },
        ]);

        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error('خطا در ارتباط با جمینای:', error);
        return null;
    }
}

run();
