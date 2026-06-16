import type { AnchorHTMLAttributes, MouseEvent } from 'react'

type MarkdownAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement>

export function openExternalLink(href?: string): void {
  if (!href) return
  window.open(href, '_blank', 'noopener,noreferrer')
}

export function ExternalMarkdownLink({ href, onClick, children, ...props }: MarkdownAnchorProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()
    openExternalLink(href)
  }

  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
    >
      {children}
    </a>
  )
}

export const externalLinkMarkdownComponents = {
  a: ExternalMarkdownLink
}
