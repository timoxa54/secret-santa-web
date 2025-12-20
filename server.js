const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

// === ПУТЬ К ФАЙЛУ ДАННЫХ ===
const DATA_FILE = path.join(__dirname, 'participants.json');

// === ФУНКЦИИ РАБОТЫ С ФАЙЛОМ ===
function loadParticipants() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf-8');
            console.log('📂 Данные загружены из файла');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('❌ Ошибка чтения файла:', error);
    }
    console.log('📝 Новый файл данных будет создан при первом сохранении');
    return [];
}

function saveParticipants() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(participants, null, 2), 'utf-8');
        console.log('💾 Данные сохранены в файл');
    } catch (error) {
        console.error('❌ Ошибка сохранения файла:', error);
    }
}

// Загружаем участников из файла при старте
let participants = loadParticipants();

// === MIDDLEWARE ===
app.use(cors());
app.use(express.json());  // Парсит JSON из тела запроса
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));  // Раздача статических файлов (HTML, CSS)

// === HELPER: Отправка email ===
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// === HELPER: Проверка токена админа ===
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.split(' ')[1] : null;
    
    console.log('🔐 Проверка токена:', token);
    
    if (!token || token !== 'admin-token-secret') {
        console.log('❌ Неверный токен');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log('✅ Токен верный');
    next();
}

// === ROUTES ===

// 1️⃣ ВХОД АДМИНА
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    
    console.log('🔑 Попытка входа, пароль:', password);
    console.log('📋 Ожидаемый пароль:', process.env.ADMIN_PASSWORD);
    
    if (password === process.env.ADMIN_PASSWORD) {
        console.log('✅ Пароль верный!');
        res.json({ token: 'admin-token-secret' });
    } else {
        console.log('❌ Пароль неверный!');
        res.status(401).json({ error: 'Неверный пароль' });
    }
});

// 2️⃣ ДОБАВЛЕНИЕ УЧАСТНИКА (с публичной формы или из админки)
app.post('/api/participants', (req, res) => {
    const { name, email, wishlist } = req.body;
    
    console.log('👤 Новый участник:', { name, email, wishlist });
    
    // Валидация
    if (!name || !email) {
        return res.status(400).json({ error: 'Заполни все поля' });
    }
    
    // Проверка на дубликаты
    if (participants.some(p => p.email === email)) {
        return res.status(400).json({ error: 'Такой email уже зарегистрирован' });
    }
    
    // Добавление участника
    const newParticipant = {
        id: Date.now(),
        name,
        email,
        wishlist: wishlist || 'Нет пожеланий',
        assignedTo: null // Кому он дарит
    };
    
    participants.push(newParticipant);
    saveParticipants();  // 💾 Сохраняем в файл
    
    console.log('✅ Участник добавлен. Всего участников:', participants.length);
    
    res.json({
        success: true,
        message: 'Участник добавлен',
        participant: newParticipant
    });
});

// 3️⃣ ПОЛУЧЕНИЕ ВСЕХ УЧАСТНИКОВ (только для админа)
app.get('/api/participants', authenticateAdmin, (req, res) => {
    console.log('📋 Запрос списка участников. Всего:', participants.length);
    res.json(participants);
});

// 3.5️⃣ УДАЛЕНИЕ УЧАСТНИКА
app.delete('/api/participants/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;
    const index = participants.findIndex(p => p.id == id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Участник не найден' });
    }
    
    const deleted = participants.splice(index, 1);
    saveParticipants();  // 💾 Сохраняем в файл
    console.log(`🗑️ Участник удалён: ${deleted[0].name}`);
    
    res.json({
        success: true,
        message: 'Участник удалён',
        participants: participants
    });
});

// 4️⃣ ГЕНИРИРОВАНИЕ НАЗНАЧЕНИЙ (Secret Santa алгоритм)
app.post('/api/generate-assignments', authenticateAdmin, (req, res) => {
    const { participants: pList } = req.body;
    
    console.log('🎲 Генерирование назначений...');
    
    if (!pList || pList.length < 2) {
        return res.status(400).json({ error: 'Нужно минимум 2 участника' });
    }
    
    // Алгоритм: создаём копию, перемешиваем, пока никто не дарит сам себе
    let shuffled = [...pList];
    let attempts = 0;
    let isValid = false;
    
    while (!isValid && attempts < 100) {
        // Перемешиваем массив (Fisher-Yates shuffle)
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        // Проверяем: нет ли самоподарков
        isValid = true;
        for (let i = 0; i < shuffled.length; i++) {
            if (pList[i].id === shuffled[i].id) {
                isValid = false;
                break;
            }
        }
        
        attempts++;
    }
    
    if (!isValid) {
        return res.status(400).json({ error: 'Не удалось сгенерировать распределение без самоподарков' });
    }
    
    // Назначаем: кто дарит кому
    for (let i = 0; i < pList.length; i++) {
        pList[i].assignedTo = shuffled[i].name; // Иван дарит Марии
        console.log(`🎁 ${pList[i].name} → ${pList[i].assignedTo}`);
    }
    
    participants = pList;
    saveParticipants();  // 💾 Сохраняем в файл
    
    console.log('✅ Назначения сгенерированы успешно!');
    
    res.json({
        success: true,
        message: 'Назначения сгенерированы',
        participants: participants
    });
});

// 5️⃣ ОТПРАВКА ПИСЕМ ВСЕМ
app.post('/api/send-emails', authenticateAdmin, async (req, res) => {
    const { participants: pList } = req.body;
    
    console.log('📧 Начинаем отправку писем...');
    
    if (!pList || pList.length === 0) {
        return res.status(400).json({ error: 'Нет участников' });
    }
    
    try {
        let sentCount = 0;
        let errors = [];
        
        for (const participant of pList) {
            if (!participant.assignedTo) {
                console.log(`⏭️ ${participant.name} пропущен (не назначен)`);
                continue;
            }
            
            // Ищем того, кому нужно дарить
            const recipientData = pList.find(p => p.name === participant.assignedTo);
            
            const emailText = `
Привет, ${participant.name}! 🎄

Поздравляем с наступающим Новым годом! 

В розыгрыше Secret Santa ты получил задание:

🎁 Ты даришь подарок: ${participant.assignedTo}
📝 Его пожелания: ${recipientData?.wishlist || 'Нет пожеланий'}

Постарайся сделать сюрприз незабываемым! 

Спасибо за участие! 🎅

---
Это письмо от Secret Santa приложения
            `;
            
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: participant.email,
                    subject: '🎁 Secret Santa - Твой подарочек!',
                    text: emailText
                });
                
                console.log(`✅ Email отправлен ${participant.email}`);
                sentCount++;
            } catch (emailError) {
                console.error(`❌ Ошибка отправки ${participant.email}:`, emailError.message);
                errors.push(`${participant.name}: ${emailError.message}`);
            }
        }
        
        const message = `Писем отправлено: ${sentCount} из ${pList.length}`;
        console.log('📊', message);
        
        if (errors.length > 0) {
            res.status(207).json({
                success: false,
                message: message,
                errors: errors
            });
        } else {
            res.json({
                success: true,
                message: message
            });
        }
        
    } catch (error) {
        console.error('❌ Общая ошибка при отправке писем:', error);
        res.status(500).json({
            error: 'Ошибка при отправке писем: ' + error.message
        });
    }
});

// === ЗАПУСК СЕРВЕРА ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📄 Форма участников: http://localhost:${PORT}/index.html`);
    console.log(`🔐 Админ-панель: http://localhost:${PORT}/admin.html`);
    console.log(`\n📋 Пароль админа: ${process.env.ADMIN_PASSWORD}`);
    console.log(`📂 Файл данных: ${DATA_FILE}`);
    console.log(`👥 Загружено участников: ${participants.length}`);
    console.log('_'.repeat(50) + '\n');
});
