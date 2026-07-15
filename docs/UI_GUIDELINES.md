# UI Guidelines

## 视觉基础

- 使用 shadcn/ui 风格和 Tailwind Design Tokens。
- 主色为低饱和紫色或蓝紫色，背景为浅灰白。
- 数据页面优先表格、分栏和 Drawer，不使用传统重型后台布局。
- 不滥用渐变、玻璃拟态、大阴影；阴影只表达浮层层级。
- 圆角、间距、边框、状态颜色必须复用现有 token 和公共组件。

## 信息与交互

- AI 结果必须显示来源、状态、置信度；关键结论不得只有生成文本。
- AI 草稿、人工审核、正式数据使用明确的状态和视觉边界。
- Loading、Empty、Error、Retry 必须复用统一组件，不以静态占位代替交互。
- 新页面优先复用现有业务组件；没有明确价值时不要新增页面。
- 表单必须有可访问 label；图标按钮必须有 `aria-label`；Drawer/Dialog 支持 Escape 和焦点可识别名称。

## Staging

- Staging 全局显示醒目的 `STAGING` 标识。
- 同时显示环境、版本、Commit 短码和构建时间，并保留完整 SHA 的可查询信息。
- 固定提示这是 Staging 试运行环境，仅允许上传虚构或已脱敏的验证资料；资料正文会真实保存，但解析、知识索引和 AI 仍未启用。
- Staging 设置 robots noindex，并由 Nginx 添加 `X-Robots-Tag`。

## 反馈入口

- 全局入口使用轻量 Drawer，不遮挡主流程。
- 只自动收集 pathname、环境、版本、Commit、User Agent 和时间。
- 不读取页面正文、项目数据、URL query、上传文件或其他业务 localStorage。
- 反馈描述需提示用户主动去除客户资料和密钥。
