'use client'

import ReactMarkdown from 'react-markdown'

/**
 * نمایش پاسخ‌های دستیار: متن فارسی، فهرست‌ها، سرفصل‌ها، جدول و پاسخ‌های طولانی
 * با ظاهر هماهنگ پیام‌رسان (RTL).
 */
export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-7 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        components={{
          p: (props) => <p className="my-2 leading-7" {...props} />,
          h1: (props) => <h1 className="text-base font-bold my-3" {...props} />,
          h2: (props) => <h2 className="text-[15px] font-bold my-2.5" {...props} />,
          h3: (props) => <h3 className="text-sm font-bold my-2" {...props} />,
          ul: (props) => <ul className="list-disc ps-5 my-2 space-y-1" {...props} />,
          ol: (props) => <ol className="list-decimal ps-5 my-2 space-y-1" {...props} />,
          li: (props) => <li className="leading-7" {...props} />,
          strong: (props) => <strong className="font-semibold" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          a: (props) => (
            <a
              className="text-primary underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote className="border-s-2 border-muted-foreground/40 ps-3 my-2 text-muted-foreground" {...props} />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? '')
            if (isBlock) {
              return (
                <code className="block bg-muted rounded-lg p-3 my-2 overflow-x-auto text-[12.5px] font-mono leading-6" {...props}>
                  {children}
                </code>
              )
            }
            return (
              <code className="bg-muted rounded px-1 py-0.5 text-[12.5px] font-mono" {...props}>
                {children}
              </code>
            )
          },
          pre: (props) => <pre className="my-2" {...props} />,
          table: (props) => (
            <div className="overflow-x-auto my-2">
              <table className="w-full text-xs border-collapse" {...props} />
            </div>
          ),
          th: (props) => (
            <th className="border px-2 py-1.5 bg-muted/60 font-semibold text-start" {...props} />
          ),
          td: (props) => <td className="border px-2 py-1.5" {...props} />,
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
