const range: number = 2
// 生成代码帧
export function generateCodeFrame(
  source: string,
  start = 0,
  end = source.length
): string {
  // Split the content into individual lines but capture the newline sequence
  // that separated each line. This is important because the actual sequence is
  // needed to properly take into account the full line length for offset
  // comparison  匹配空格或都制作符
  let lines = source.split(/(\r?\n)/)

  // Separate the lines and newline sequences into separate arrays for easier referencing 获取隔行
  const newlineSequences = lines.filter((_, idx) => idx % 2 === 1);
  // 或取行
  lines = lines.filter((_, idx) => idx % 2 === 0)

  let count = 0
  const res: string[] = []
  // 循环行
  for (let i = 0; i < lines.length; i++) {
    // 获取行字符串数拼接
    count +=
      lines[i].length +
      ((newlineSequences[i] && newlineSequences[i].length) || 0)
      // 如果数大于等于开始
      if (count >= start) {
        // 要从第负二个字符开始 如果J 小于第I个后数两个或都结束大于两行数  j ++
        for (let j = i - range; j <= i + range || end > count; j++) {
          // 如果j < 0 或者j 大于等于行的长度
        if (j < 0 || j >= lines.length) continue

        // 获取行数
        const line = j + 1
        // res压入行数经与行的第J个
        res.push(
          `${line}${' '.repeat(Math.max(3 - String(line).length, 0))}|  ${
            lines[j]
          }`
        )
        // 获取行列的长度
        const lineLength = lines[j].length
        // 获取新行SeQ长茺
        const newLineSeqLength =
          (newlineSequences[j] && newlineSequences[j].length) || 0
        // 如果j == i
        if (j === i) {
          // push underline pad 指向
          const pad = start - (count - (lineLength + newLineSeqLength))
          // 获取长度
          const length = Math.max(
            1,
            end > count ? lineLength - pad : end - start
          )
          // res压入字符
          res.push(`   |  ` + ' '.repeat(pad) + '^'.repeat(length))
        // 如果 k > i 
        } else if (j > i) {
          // 如果end 大于count 
          if (end > count) {
            // 获取length
            const length = Math.max(Math.min(end - count, lineLength), 1)
            // res压入换替换后的长度
            res.push(`   |  ` + '^'.repeat(length))
          }
          // 数据拼接
          count += lineLength + newLineSeqLength
        }
      }
      break
    }
  }
  // 返回res
  return res.join('\n')
}
