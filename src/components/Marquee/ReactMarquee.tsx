
import { useRef, useEffect, useState, ReactNode } from 'react'
import './marquee.css'

import { cn } from "@/lib/utils"

interface MarqueeProps {
    className?: string
    children: ReactNode
    speed?: number
}

export function ReactMarquee({ className, children, speed = 20 }: MarqueeProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const [isOverflowing, setIsOverflowing] = useState(false)

    useEffect(() => {
        const checkOverflow = () => {
            if (containerRef.current && contentRef.current) {
                const isOverflowing = contentRef.current.scrollWidth > containerRef.current.clientWidth
                setIsOverflowing(isOverflowing)

                if (isOverflowing) {
                    const contentWidth = contentRef.current.scrollWidth
                    const containerWidth = containerRef.current.clientWidth
                    const duration = (contentWidth / speed) * (containerWidth / contentWidth)
                    containerRef.current.style.setProperty('--duration', `${duration}s`)
                }
            }
        }

        checkOverflow()
        window.addEventListener('resize', checkOverflow)
        return () => window.removeEventListener('resize', checkOverflow)
    }, [children, speed])

    return (
        <div
            ref={containerRef}
            className={cn(
                "overflow-hidden whitespace-nowrap",
                isOverflowing && "marquee-container",
                className
            )}
        >
            <div
                ref={contentRef}
                className={cn(
                    "inline-block",
                    isOverflowing && "marquee-content"
                )}
            >
                {children}
            </div>
            {/* {isOverflowing && (
                <div aria-hidden="true" className="inline-block marquee-content">
                    {children}
                </div>
            )} */}
        </div>
    )
}