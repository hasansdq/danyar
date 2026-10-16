// بررسی واقعی z-ai-web-dev-sdk در محیط — برای سرور آزمون مرحله ۶
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  try {
    const zai = await ZAI.create()
    const t0 = Date.now()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'پاسخ‌ده فارسی، خیلی کوتاه.' },
        { role: 'user', content: 'سلام! در یک جمله بگو چه کسی هستی.' },
      ],
      thinking: { type: 'disabled' },
    })
    console.log('OK', Date.now() - t0, 'ms')
    console.log('REPLY:', completion.choices[0]?.message?.content?.slice(0, 200))
    // آیا پارامتر tools را می‌پذیرد؟
    try {
      const withTools = await zai.chat.completions.create({
        messages: [{ role: 'user', content: 'وضعیت تکالیف را بگو' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'assignment_status',
              description: 'وضعیت تکالیف',
              parameters: { type: 'object', properties: {} },
            },
          },
        ] as never,
        thinking: { type: 'disabled' },
      })
      const msg = withTools.choices[0]?.message as Record<string, unknown> | undefined
      console.log('TOOLS-ACCEPTED: true')
      console.log('TOOLCALLS:', JSON.stringify(msg?.tool_calls ?? null)?.slice(0, 300))
      console.log('CONTENT:', String(msg?.content ?? '').slice(0, 150))
    } catch (e) {
      console.log('TOOLS-ACCEPTED: false —', (e as Error).message?.slice(0, 200))
    }
  } catch (e) {
    console.log('ZAI-FAIL:', (e as Error).message?.slice(0, 300))
  }
}
main()
