const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Переменные окружения
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT) || 587;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '12345';

// Файл данных (в памяти для Vercel)
let participants = [];

// Создание транспортера email
const transporter = nodemailer.createTransporter({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: false,
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASSWORD
    }
});

// === API ROUTES ===

// 1. Добавление участника (из формы)
app.post('/api/participants', (req, res) => {
    const { name, email, wishlist } = req.body;
    
    if (!name || !email) {
        return res.status(400).json({ error: 'Имя и email обязательны' });
    }

    const newParticipant = {
        id: Date.now().toString(),
        name,
        email,
        wishlist: wishlist || '',
        assignedTo: null
    };

    participants.push(newParticipant);
    console.log('Добавлен участник:', newParticipant);
    
    res.json({ success: true, participant: newParticipant });
});

// 2. Получить всех участников (админ)
app.get('/api/participants', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== 'Bearer admin-token-123') {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    res.json(participants);
});

// 3. Админ логин
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ token: 'admin-token-123' });
    } else {
        res.status(401).json({ error: 'Неверный пароль' });
    }
});

// 4. Удалить участника
app.delete('/api/participants/:id', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== 'Bearer admin-token-123') {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const id = req.params.id;
    participants = participants.filter(p => p.id !== id);
    res.json({ success: true, participants });
});

// 5. Назначить подарки (алгоритм Secret Santa)
app.post('/api/generate-assignments', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== 'Bearer admin-token-123') {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const { participants: inputParticipants } = req.body;
    
    if (inputParticipants.length < 2) {
        return res.status(400).json({ error: 'Нужно минимум 2 участника' });
    }

    // Алгоритм Secret Santa (круговая перестановка)
    const shuffled = [...inputParticipants].sort(() => Math.random() - 0.5);
    const assignments = shuffled.map((participant, index) => {
        const assignedTo = shuffled[(index + 1) % shuffled.length].name;
        return { ...participant, assignedTo };
    });

    participants = assignments;
    res.json({ success: true, participants: assignments });
});

// 6. Отправить emails
app.post('/api/send-emails', async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== 'Bearer admin-token-123') {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const { participants: assignments } = req.body;
    
    if (!EMAIL_USER || !EMAIL_PASSWORD) {
        return res.status(500).json({ error: 'Email настройки не настроены' });
    }

    try {
        const mailOptions = {
            from: `"Secret Santa" <${EMAIL_USER}>`,
            subject: '🎁 Твой Secret Santa назначен!',
            html: `
                <h1>🎄 Secret Santa 2025</h1>
                <p><strong>Ты даришь подарок:</strong></p>
                <h2>${assignments.find(p => p.assignedTo === req.body.fromName)?.name || 'Неизвестно'}</h2>
                <p><strong>Его виш-лист:</strong></p>
                <blockquote>${assignments.find(p => p.assignedTo === req.body.fromName)?.wishlist || 'Нет пожеланий'}</blockquote>
                <p>Бюджет: 1000-3000 руб.</p>
                <hr>
                <small>С любовью, Secret Santa 🎅</small>
            `
        };

        // Отправляем каждому
        for (const participant of assignments) {
            mailOptions.to = participant.email;
            mailOptions.text = `Ты даришь: ${participant.assignedTo}. Виш-лист: ${participant.wishlist}`;
            
            await transporter.sendMail(mailOptions);
        }

        res.json({ success: true, message: 'Письма отправлены!' });
    } catch (error) {
        console.error('Email error:', error);
        res.status(500).json({ error: 'Ошибка отправки писем' });
    }
});

// 7. Обновить участника (редактирование)
app.put('/api/participants/:id', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.includes('admin-token')) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const id = req.params.id;
    const { name, email, wishlist } = req.body;

    if (!name || !email) {
        return res.status(400).json({ error: 'Имя и email обязательны' });
    }

    const participantIndex = participants.findIndex(p => p.id === id);
    if (participantIndex === -1) {
        return res.status(404).json({ error: 'Участник не найден' });
    }

    // ✅ ОБНОВЛЯЕМ НА СЕРВЕРЕ
    participants[participantIndex] = {
        ...participants[participantIndex],
        name: name.trim(),
        email: email.trim(),
        wishlist: wishlist || ''
    };

    console.log('✅ Участник обновлён:', participants[participantIndex]);
    res.json({ success: true, participant: participants[participantIndex] });
});


module.exports = app;
