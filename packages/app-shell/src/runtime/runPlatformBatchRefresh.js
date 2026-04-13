export async function runPlatformBatchRefresh (options = {}) {
  const {
    svc,
    quotaActions,
    toast,
    batchId,
    silent = false,
    setLoading,
    preparingText = '准备刷新账号配额...',
    progressText = ({ completed, total }) => `正在刷新配额 (${completed}/${total})...`,
    successText = '全部账号配额刷新完成',
    errorText = (error) => '批量刷新失败: ' + (error?.message || String(error)),
    resolveIssue = null,
    concurrency = 1,
    delayMs = 0,
    refreshAccount = null,
    onCompleted = null,
    onFailed = null
  } = options

  if (!svc || !quotaActions || quotaActions.batchRunning) {
    return { success: false, skipped: true, failures: [], total: 0 }
  }

  const latestAccounts = svc.list?.() || []
  const total = latestAccounts.length
  if (total === 0) {
    return { success: true, skipped: false, failures: [], total: 0 }
  }

  const accountMap = new Map(latestAccounts.map((account) => [account.id, account]))

  try {
    if (!silent) {
      setLoading?.(true)
      toast?.upsert?.(batchId, preparingText, 'info', 0)
    }

    const batch = await quotaActions.runBatch(
      latestAccounts.map((account) => account.id),
      (accountId) => Promise.resolve(
        typeof refreshAccount === 'function'
          ? refreshAccount(accountId)
          : svc.refreshQuotaOrUsage(accountId)
      ),
      {
        concurrency,
        delayMs,
        onProgress: ({ completed }) => {
          if (!silent) {
            const progress = Math.round((completed / total) * 100)
            toast?.upsert?.(batchId, progressText({ completed, total }), 'info', progress)
          }
        }
      }
    )

    const failures = []
    for (let i = 0; i < batch.results.length; i++) {
      const item = batch.results[i]
      const account = accountMap.get(item.id)
      const issue = typeof resolveIssue === 'function'
        ? resolveIssue(item, account)
        : (item.ok ? item.value?.error : (item.error?.message || String(item.error || '刷新失败')))
      if (!issue) continue
      failures.push({
        email: account?.email || account?.id || item.id,
        error: issue
      })
    }

    await Promise.resolve(onCompleted?.({
      total,
      failures,
      batch,
      accounts: latestAccounts
    }))

    if (!silent) {
      if (failures.length > 0) {
        const first = failures[0]
        toast?.warning?.(`其中 ${failures.length} 个账号刷新失败：${first.email} - ${first.error}`)
      } else {
        toast?.success?.(successText)
      }
    }

    return {
      success: true,
      skipped: false,
      total,
      failures,
      batch
    }
  } catch (error) {
    await Promise.resolve(onFailed?.(error))
    if (!silent) {
      toast?.error?.(typeof errorText === 'function' ? errorText(error) : String(errorText || error))
    }
    return {
      success: false,
      skipped: false,
      total,
      failures: [],
      error
    }
  } finally {
    if (!silent) {
      setLoading?.(false)
      if (batchId) {
        setTimeout(() => toast?.remove?.(batchId), 1000)
      }
    }
  }
}
