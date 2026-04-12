/**
 * 平台图标组件集合
 * SVG 数据来源：lobehub/lobe-icons
 * 三个彩色图标在深/浅主题下均无需切换颜色
 */
import codexSvg from '../../assets/icons/codex.svg'
import geminiSvg from '../../assets/icons/gemini.svg'

/**
 * Antigravity — 多色品牌标志（内联 SVG，滤镜需要内联才能正确渲染）
 */
export function AntigravityIcon ({ size = 20, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' aria-hidden='true'>
      <mask id='ag-m' maskUnits='userSpaceOnUse' width='24' height='23' x='0' y='1'>
        <path d='M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z' fill='#fff' />
      </mask>
      <g mask='url(#ag-m)'>
        <g filter='url(#ag0)'><path d='M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z' fill='#FFE432' /></g>
        <g filter='url(#ag1)'><path d='M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z' fill='#FC413D' /></g>
        <g filter='url(#ag2)'><path d='M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z' fill='#00B95C' /></g>
        <g filter='url(#ag3)'><path d='M-7.608 14.703c3.352 3.424 9.126 3.208 12.896-.483 3.77-3.69 4.108-9.459.756-12.883C2.69-2.087-3.083-1.871-6.853 1.82c-3.77 3.69-4.108 9.458-.755 12.883z' fill='#00B95C' /></g>
        <g filter='url(#ag4)'><path d='M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z' fill='#3186FF' /></g>
        <g filter='url(#ag5)'><path d='M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z' fill='#FBBC04' /></g>
        <g filter='url(#ag6)'><path d='M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z' fill='#3186FF' /></g>
        <g filter='url(#ag7)'><path d='M28.71 17.471c-1.413 1.649-5.1.808-8.236-1.878-3.135-2.687-4.531-6.201-3.118-7.85 1.412-1.649 5.1-.808 8.235 1.878s4.532 6.2 3.119 7.85z' fill='#749BFF' /></g>
        <g filter='url(#ag8)'><path d='M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z' fill='#FC413D' /></g>
        <g filter='url(#ag9)'><path d='M-.915 2.684c-1.44 3.473-.97 6.967 1.05 7.804 2.02.837 4.824-1.3 6.264-4.772 1.44-3.473.97-6.967-1.05-7.804-2.02-.837-4.824 1.3-6.264 4.772z' fill='#FFEE48' /></g>
      </g>
      <defs>
        <filter id='ag0' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='-3.288' y='-11.917' width='19.838' height='17.587'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='1.117' /></filter>
        <filter id='ag1' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='4.251' y='-13.493' width='38.9' height='38.565'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='5.4' /></filter>
        <filter id='ag2' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='-21.889' y='-10.592' width='40.955' height='36.517'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='4.591' /></filter>
        <filter id='ag3' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='-19.099' y='-10.278' width='36.632' height='36.595'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='4.591' /></filter>
        <filter id='ag4' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='.981' y='8.758' width='33.533' height='34.087'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='4.363' /></filter>
        <filter id='ag5' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='-6.143' y='-21.659' width='35.978' height='35.276'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='3.954' /></filter>
        <filter id='ag6' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='-11.96' y='-.46' width='45.114' height='46.523'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='3.531' /></filter>
        <filter id='ag7' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='10.485' y='.58' width='25.094' height='24.054'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='3.159' /></filter>
        <filter id='ag8' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='5.833' y='-12.467' width='33.508' height='30.007'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='2.669' /></filter>
        <filter id='ag9' colorInterpolationFilters='sRGB' filterUnits='userSpaceOnUse' x='-8.355' y='-8.876' width='22.194' height='26.151'><feFlood floodOpacity='0' result='bg' /><feBlend in='SourceGraphic' in2='bg' result='s' /><feGaussianBlur stdDeviation='3.303' /></filter>
      </defs>
    </svg>
  )
}

/** Codex — 紫蓝渐变代码符号 */
export function CodexIcon ({ size = 20, className = '' }) {
  return <img src={codexSvg} width={size} height={size} className={className} alt='' aria-hidden='true' />
}

/** Gemini — 多色四角星 */
export function GeminiIcon ({ size = 20, className = '' }) {
  return <img src={geminiSvg} width={size} height={size} className={className} alt='' aria-hidden='true' />
}

/** Dashboard — 仪表盘图标 */
export function DashboardIcon ({ size = 20, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M113.524386 638.506773c-36.898436 0-66.679689-28.987184-66.679689-64.747032V155.193255c0-59.59261 49.784825-107.913726 111.133484-107.913726h244.489517c36.899774 0 66.679689 28.985846 66.679689 64.746362v461.73385c0 35.760516-29.779915 64.747032-66.679689 64.747032H113.524386z m795.712962-168.919203H620.290022c-36.894422 0-66.681027-29.851495-66.681026-66.679689V113.959218c0-36.828863 29.786605-66.679689 66.681026-66.679689h244.494869c61.343976 0 111.133484 49.765425 111.133484 111.133484v244.489516c0 36.833546-29.786605 66.685041-66.681027 66.685041m-751.259167 506.765636c-61.348659 0-111.133484-49.334608-111.133484-110.16682v-77.120321c0-36.509764 29.781253-66.097684 66.679689-66.097684h288.943312c36.899774 0 66.679689 29.588589 66.679689 66.097684v121.184105c0 36.509764-29.779915 66.103036-66.679689 66.103036H157.978181z m706.80671 0H620.290022c-36.894422 0-66.681027-29.851495-66.681026-66.681027V620.724854c0-36.828194 29.786605-66.681027 66.681026-66.681027h288.947326c36.894422 0 66.681027 29.852833 66.681027 66.681027v244.494868c0 61.368059-49.789508 111.133484-111.133484 111.133484"></path>
    </svg>
  )
}

/** 根据平台 ID 获取图标 */
export function PlatformIcon ({ platform, size = 20, className = '' }) {
  switch (platform) {
    case 'dashboard':
      return <DashboardIcon size={size} className={className} />
    case 'antigravity':
      return <AntigravityIcon size={size} className={className} />
    case 'codex':
      return <CodexIcon size={size} className={className} />
    case 'gemini':
      return <GeminiIcon size={size} className={className} />
    default:
      return null
  }
}
