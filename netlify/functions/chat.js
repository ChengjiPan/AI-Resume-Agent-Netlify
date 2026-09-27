import { knowledgeDocuments } from "./_shared/knowledge.js";

const SYSTEM_PROMPT = `你是 Calvin AI Resume Assistant。只根据提供的个人知识库回答。
如果资料不足、存在版本冲突或无法确认，请明确说明，不要编造，也不要补充资料中没有的数据、职责或结论。

当问题涉及某一段具体实习或项目时，必须使用下面的六项结构；没有资料的项目要明确写“资料未提供”：
1. 项目背景
2. 我的角色
3. 我的任务
4. 使用的方法
5. 数据结果
6. 产品价值

当问题是能力、教育或职业优势等概述类问题时，使用清晰的要点回答，并把每项判断与资料对应。回答使用中文，简洁、专业、适合招聘经理阅读。`;

function sectionChunks(document) {
  const sections = document.content.split(/^##\s+/m);
  const intro = sections.shift()?.trim();
  const chunks = [];
  if (intro) chunks.push({ file: document.file, section: "概览", content: intro });
  for (const item of sections) {
    const [heading, ...body] = item.split("\n");
    const content = body.join("\n").trim();
    if (content) chunks.push({ file: document.file, section: heading.trim(), content });
  }
  return chunks;
}

const chunks = knowledgeDocuments.flatMap(sectionChunks);

function queryTerms(question) {
  const normalized = question.toLowerCase();
  const words = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) || [];
  const pairs = [];
  for (const word of words) {
    for (let index = 0; index < word.length - 1; index += 1) pairs.push(word.slice(index, index + 2));
  }
  return [...new Set([...words, ...pairs])].filter((term) => term.length >= 2);
}

function retrieve(question) {
  const terms = queryTerms(question);
  return chunks
    .map((chunk) => {
      const haystack = (chunk.section + "\n" + chunk.content).toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? term.length ** 2 : 0), 0);
      return { ...chunk, score };
    })
    .sort((left, right) => right.score - left.score)
    .filter((chunk) => chunk.score > 0)
    .slice(0, 4);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async (request) => {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);

  const apiKey = Netlify.env.get("DASHSCOPE_API_KEY");
  if (!apiKey) return json({ detail: "服务尚未配置 DASHSCOPE_API_KEY。" }, 500);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ detail: "请求格式不正确。" }, 400);
  }

  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  if (question.length < 2 || question.length > 1000) {
    return json({ detail: "问题长度需要在 2 到 1000 个字符之间。" }, 400);
  }

  const passages = retrieve(question);
  if (!passages.length) {
    return json({
      answer: "现有知识库中没有找到足够相关的资料，无法基于真实资料确认这一点。",
      sources: [],
    });
  }

  const context = passages
    .map((item) => `[来源：${item.file} · ${item.section}]\n${item.content}`)
    .join("\n\n");

  try {
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-plus",
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `知识库：\n${context}\n\n问题：${question}` },
        ],
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const category = status === 401 || status === 403
        ? "密钥无效或没有模型调用权限"
        : status === 429
          ? "模型额度不足或请求过于频繁"
          : "模型服务暂时不可用";
      console.error("DashScope request failed", status);
      return json({ detail: `${category}（HTTP ${status}）。` }, 502);
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      return json({ detail: "模型没有返回有效回答，请稍后重试。" }, 502);
    }

    return json({
      answer: answer.trim(),
      sources: passages.map((item) => ({
        file: item.file,
        section: item.section,
        excerpt: item.content.replace(/\s+/g, " ").slice(0, 220),
      })),
    });
  } catch (error) {
    console.error("Chat function error", error);
    return json({ detail: "服务暂时不可用，请稍后重试。" }, 502);
  }
};

export const config = {
  path: "/api/chat",
  method: ["POST"],
};
