import type { Outcome } from '../types.js'

export class ProgressLogger {
  private completed = 0
  private errors = 0
  private startTime = Date.now()
  private outcomes: Record<string, number> = {
    confirmed: 0, review_needed: 0, unmatched: 0, skipped: 0, error: 0,
  }
  private verbose: boolean

  constructor(private total: number, verbose = false) {
    this.verbose = verbose
  }

  increment(outcome?: Outcome) {
    this.completed++
    if (outcome) this.outcomes[outcome] = (this.outcomes[outcome] ?? 0) + 1

    const interval = Math.max(1, Math.floor(this.total / 10))
    if (this.completed % interval === 0 || this.completed === this.total) {
      const pct = Math.round((this.completed / this.total) * 100)
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
      console.log(`[${pct}%] ${this.completed}/${this.total} 処理済み (${elapsed}秒経過)`)
    }
  }

  logVerbose(inputId: string, message: string) {
    if (this.verbose) {
      console.log(`  [${inputId}] ${message}`)
    }
  }

  logError(inputId: string, error: unknown) {
    this.errors++
    console.error(`[ERROR] 行${inputId}: ${error instanceof Error ? error.message : String(error)}`)
  }

  printSummary() {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
    console.log(`\n=== 処理完了 ===`)
    console.log(`総件数: ${this.total}`)
    console.log(`  自動確定:   ${this.outcomes.confirmed ?? 0}`)
    console.log(`  要確認:     ${this.outcomes.review_needed ?? 0}`)
    console.log(`  不一致:     ${this.outcomes.unmatched ?? 0}`)
    console.log(`  スキップ:   ${this.outcomes.skipped ?? 0}`)
    console.log(`  エラー:     ${this.outcomes.error ?? 0}`)
    console.log(`処理時間: ${elapsed}秒`)
    const total = this.total || 1
    console.log(`自動確定率: ${Math.round(((this.outcomes.confirmed ?? 0) / total) * 100)}%`)
  }
}
