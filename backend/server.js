require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = 3001;

const allowedOrigins = ['http://localhost:5173', 'https://dieter01.netlify.app'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json({ limit: '10mb' }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set. Please check your .env file.');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash-preview-09-2025' 
});

const RECOMMENDED_INTAKE = {
  male: {
    calories: 2500,
    carbs: 324,
    protein: 60,
    fat: 54,
    sodium: 2000
  },
  female: {
    calories: 2000,
    carbs: 270,
    protein: 50,
    fat: 45,
    sodium: 2000
  }
};

app.post('/analyze-image', async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ error: 'Missing imageBase64 or mimeType' });
    }
    
    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: mimeType,
      },
    };
    

    const prompt = "Analyze this food item and return ONLY a valid JSON object with foodName, calories, and a nutrients object containing: protein (g), fat (g), carbohydrates (g), sugar (g), and sodium (mg).";
    
    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();

    console.log('--- Raw text from Gemini (Image) ---');
    console.log(text);

    let jsonData;
    try {
      let jsonText = text;
      const markdownMatch = text.match(/```json([\s\S]*)```/);
      if (markdownMatch && markdownMatch[1]) {
        jsonText = markdownMatch[1];
      } else {
        const rawJsonMatch = text.match(/\{[\s\S]*\}/);
        if (rawJsonMatch) jsonText = rawJsonMatch[0];
      }
      
      const cleanedJsonText = jsonText.replace(/[^\S \t\r\n\f\v{}[\]":,0-9.truefalsenull-]/g, '');
      jsonData = JSON.parse(cleanedJsonText);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      return res.status(500).json({ error: 'Gemini API returned malformed JSON.', details: text });
    }

    res.status(200).json(jsonData);

  } catch (error) {
    console.error('Error in /analyze-image:', error);
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});


app.post('/get-recommendation', async (req, res) => {
  try {
    const { gender, currentIntake, totals, foodList } = req.body;
    const intakeData = currentIntake || totals;


    if (!gender || !['male', 'female'].includes(gender)) {
      return res.status(400).json({ error: 'Invalid gender. Must be "male" or "female".' });
    }
    if (!intakeData) {
      return res.status(400).json({ error: 'Missing intake data (currentIntake or totals).' });
    }

    const standard = RECOMMENDED_INTAKE[gender];

    const eatenFoods = (foodList && foodList.length > 0) ? foodList.join(', ') : "없음";

    console.log(`[추천 요청] 성별: ${gender}, 먹은 음식: ${eatenFoods}`);

    const prompt = `
      당신은 전문 영양사입니다. 
      아래 [사용자 기준]과 [오늘 섭취 현황]을 비교하여 **저녁 메뉴 1가지**를 추천해주세요.

      [1. 사용자 기준 (${gender === 'male' ? '남성' : '여성'} 권장량)]
      - 칼로리: ${standard.calories}kcal
      - 탄수화물: ${standard.carbs}g
      - 단백질: ${standard.protein}g
      - 지방: ${standard.fat}g
      - 나트륨: ${standard.sodium}mg

      [2. 오늘 섭취 현황]
      - 먹은 음식: ${eatenFoods}
      - 섭취 영양소: 칼로리 ${intakeData.calories || 0}, 탄수화물 ${intakeData.carbs || 0}g, 단백질 ${intakeData.protein || 0}g, 지방 ${intakeData.fat || 0}g, 나트륨 ${intakeData.sodium || 0}mg

      [요청 사항]
      1. 오늘 먹은 음식과 겹치지 않으면서, 부족한 영양소를 채워주는 한국식 저녁 메뉴를 추천하세요.
      2. **반드시 아래 JSON 형식으로만 응답하세요.** (Markdown 없이 JSON만)

      {
        "menuName": "메뉴 이름",
        "calories": 숫자(kcal),
        "reason": "추천 이유 한 문장"
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const recommendation = JSON.parse(text);
    
    res.status(200).json(recommendation);

  } catch (error) {
    console.error('Error in /get-recommendation:', error);
    res.status(500).json({ error: 'Failed to generate recommendation' });
  }
});

app.listen(port, () => {
  console.log(`Dieter backend listening on http://localhost:${port}`);
});
