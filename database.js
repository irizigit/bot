// database.js - الإصدار المحدث مع إنشاء مجلدات المواد في GitHub

const { Pool } = require('pg');
const state = require('./state.js');
const { Octokit } = require("@octokit/rest");
const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = require('./config.js');

// --- إعدادات الاتصال بـ GitHub ---
let octokit;
if (GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO) {
    octokit = new Octokit({ auth: GITHUB_TOKEN });
    console.log('[🐙] GitHub client configured successfully.');
} else {
    console.warn('[⚠️] GitHub configuration is missing. Folder creation and file uploads will fail.');
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error("[❌] FATAL: DATABASE_URL is not defined in environment variables.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

console.log('[✅] Database connection pool configured.');

async function createGitHubFolders(setupData) {
    if (!octokit) {
        console.error('[❌] Cannot create GitHub folders because GitHub client is not configured.');
        throw new Error('إعدادات GitHub غير مكتملة.');
    }

    console.log('[🐙] Starting GitHub folder structure creation...');
    const sectionName = setupData.sectionName;

    for (const classData of setupData.classes) {
        if (!classData) continue;
        const className = classData.className;

        // --- التعديل هنا: إضافة حلقة تكرارية للمرور على المواد ---
        for (const subjectName of classData.subjects) {
            // إنشاء مسار جديد يتضمن اسم المادة
            const path = `lectures/${sectionName}/${className}/${subjectName}/.gitkeep`;
            
            try {
                await octokit.repos.createOrUpdateFileContents({
                    owner: GITHUB_OWNER,
                    repo: GITHUB_REPO,
                    path: path,
                    message: `BOT: Create folder structure for ${sectionName}/${className}/${subjectName}`,
                    content: Buffer.from('').toString('base64'), // ملف فارغ لإنشاء المجلد
                });
                console.log(`[🐙] Successfully created folder: ${path}`);
            } catch (error) {
                if (error.status === 422) { 
                     console.warn(`[🐙] Folder/file at ${path} likely already exists. Continuing...`);
                } else {
                    console.error(`[❌] Failed to create GitHub folder at ${path}`, error);
                    throw new Error('فشل إنشاء المجلدات في GitHub.');
                }
            }
        }
    }
}

async function loadAllData() {
    const client = await pool.connect();
    try {
        const devResult = await client.query("SELECT userid FROM developers");
        state.admins = new Set(devResult.rows.map(row => row.userid));
        console.log(`[DB] Loaded ${state.admins.size} developer(s).`);
    } catch (error) {
        console.error('[❌] FATAL: Failed to load developers data.', error);
        throw error;
    } finally {
        client.release();
    }
}

async function loadCoursesData() {
    const client = await pool.connect();
    try {
        const [sectionsResult, classesResult, subjectsResult, groupsResult, professorsResult] = await Promise.all([
            client.query("SELECT * FROM sections"),
            client.query("SELECT * FROM classes"),
            client.query("SELECT * FROM subjects"),
            client.query("SELECT * FROM course_groups"),
            client.query("SELECT * FROM professors")
        ]);

        state.sections = new Map(sectionsResult.rows.map(row => [row.id, row]));
        state.classes = new Map(classesResult.rows.map(row => [row.id, row]));
        state.subjects = new Map(subjectsResult.rows.map(row => [row.id, row]));
        state.groupsData = new Map(groupsResult.rows.map(row => [row.id, row]));
        state.professors = new Map(professorsResult.rows.map(row => [row.id, row]));
        console.log(`[DB] Course data loaded successfully.`);
    } catch (error) {
        console.error('[❌] Error loading courses data:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function saveSectionSetup(setupData) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const sectionRes = await client.query('INSERT INTO sections (name) VALUES ($1) RETURNING id', [setupData.sectionName]);
        const sectionId = sectionRes.rows[0].id;

        for (const classData of setupData.classes) {
            if (!classData) continue;
            const classRes = await client.query('INSERT INTO classes (name, section_id) VALUES ($1, $2) RETURNING id', [classData.className, sectionId]);
            const classId = classRes.rows[0].id;
            for (const subjectName of classData.subjects) {
                await client.query('INSERT INTO subjects (name, class_id) VALUES ($1, $2)', [subjectName, classId]);
            }
            for (const groupData of classData.groups) {
                await client.query('INSERT INTO professors (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [groupData.professorName]);
                await client.query('INSERT INTO course_groups (name, class_id) VALUES ($1, $2)', [groupData.groupName, classId]);
            }
        }

        await createGitHubFolders(setupData);
        
        await client.query('COMMIT');
        console.log(`[DB] Successfully saved new section: ${setupData.sectionName}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[❌] Error in saveSectionSetup transaction:', error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    loadAllData,
    loadCoursesData,
    saveSectionSetup,
};