import AppKit
let out = CommandLine.arguments[1]
let tmp = "/var/folders/hq/5bk46wgs1q3cgz3tpb8q9stc0000gn/T/codex-clipboard-"
let ids = ["d8ad31c3-bf45-4b18-89a6-fcfafc443719", "a9850d53-ed71-4012-abcc-90b3affc076c", "6709c906-8884-42d6-8f68-e972c348652c", "b290ed58-f85d-4ee7-9331-38de91b3820f", "00984cfe-cfa5-4fd0-9051-8b39f74e98c1", "960c0315-0fc9-40ca-839f-3def5b02580a", "b378bb12-467d-483f-8bf0-45a4d78bbb1c"]
let imgs = ids.map { NSImage(contentsOfFile: tmp + $0 + ".png")! }
let navy = NSColor(srgbRed:0.13, green:0.21, blue:0.42, alpha:1)
let red = NSColor(srgbRed:0.69, green:0.25, blue:0.21, alpha:1)
var H: CGFloat = 800
func rect(_ x:CGFloat,_ y:CGFloat,_ w:CGFloat,_ h:CGFloat)->NSRect {NSRect(x:x,y:H-y-h,width:w,height:h)}
func text(_ str:String,_ x:CGFloat,_ y:CGFloat,_ w:CGFloat,_ size:CGFloat,_ color:NSColor = navy,_ centered:Bool = false) {
 let p = NSMutableParagraphStyle(); p.alignment = centered ? .center : .left
 let f = NSFont(name:"PingFangSC-Semibold",size:size) ?? NSFont.boldSystemFont(ofSize:size)
 (str as NSString).draw(in:rect(x,y,w,size*1.5),withAttributes:[.font:f,.foregroundColor:color,.paragraphStyle:p])
}
func shot(_ im:NSImage,_ x:CGFloat,_ y:CGFloat,_ w:CGFloat,_ h:CGFloat) {
 let r=rect(x,y,w,h)
 im.draw(in:r,from:.zero,operation:.copy,fraction:1)
 NSColor(srgbRed:0.65,green:0.68,blue:0.73,alpha:1).setStroke()
 let b=NSBezierPath(roundedRect:r,xRadius:4,yRadius:4); b.lineWidth=1; b.stroke()
}
func render(_ name:String,_ w:Int=1280,_ h:Int=800,_ body:()->Void) {
 H=CGFloat(h)
 let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:w,pixelsHigh:h,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
 NSGraphicsContext.current?.imageInterpolation = .high
 NSColor(srgbRed:0.972,green:0.961,blue:0.89,alpha:1).setFill(); NSRect(x:0,y:0,width:w,height:h).fill()
 NSColor(srgbRed:0.84,green:0.84,blue:0.78,alpha:0.55).setStroke()
 for y in stride(from:20,to:h,by:32) {let p=NSBezierPath();p.move(to:CGPoint(x:0,y:y));p.line(to:CGPoint(x:w,y:y));p.lineWidth=0.5;p.stroke()}
 body()
 NSGraphicsContext.restoreGraphicsState()
 try! rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:out+"/"+name+".png"))
 print(name,rep.pixelsWide,rep.pixelsHigh)
}
func header(_ title:String="播客智能阅读助手") {text("P O D C A S T   F I E L D   N O T E S",0,14,1280,13,navy,true);text(title,0,36,1280,34,navy,true)}
for (name,indices) in [("02-reading",[0,1,2]),("03-features",[3,4,5])] {
 render(name) {header();for (i,n) in indices.enumerated(){let im=imgs[n];let w:CGFloat=392;let h=w*im.size.height/im.size.width;shot(im,CGFloat(28+i*416),100,w,h)}}
}
render("01-overview") {header();let im=imgs[6];let w:CGFloat=1224;let h=w*im.size.height/im.size.width;shot(im,28,120,w,h)}
// Large, readable excerpts use original pixels. Each includes a single relevant area.
let details:[(String,Int,CGFloat,CGFloat,String,String)] = [
 ("detail-01-transcript",0,820,870,"智能稿本","按时间阅读访谈\n点击时间戳跳转"),
 ("detail-02-map",1,305,995,"内容地图","主题章节\n快速理解访谈脉络"),
 ("detail-03-timeline",2,290,820,"人物脉络","关键经历\n梳理人生转折"),
 ("detail-04-highlights",3,280,1060,"高光切片","发现精彩片段\n理解内容价值"),
 ("detail-05-rewrite",4,855,800,"内容重构","从访谈到文章\n沉淀可读内容"),
 ("detail-06-explore",5,300,900,"延伸探索","相关视频播客\n继续深入了解")]
for (name,n,y,ch,title,subtitle) in details {
 render(name) {
  text("播客智能阅读助手",36,35,430,21)
  text(title,36,180,330,44)
  let lines=subtitle.components(separatedBy:"\n"); for (i,l) in lines.enumerated(){text(l,38,255+CGFloat(i*38),350,23)}
  text("PODCAST FIELD NOTES",38,720,350,12,red)
  var r=NSRect.zero;let cg=imgs[n].cgImage(forProposedRect:&r,context:nil,hints:nil)!
  let crop=cg.cropping(to:CGRect(x:30,y:y,width:CGFloat(cg.width)-60,height:min(ch,CGFloat(cg.height)-y)))!
  let im=NSImage(cgImage:crop,size:NSSize(width:crop.width,height:crop.height))
  let s=min(840/CGFloat(crop.width),700/CGFloat(crop.height));let w=CGFloat(crop.width)*s;let h=CGFloat(crop.height)*s
  shot(im,410+(840-w)/2,50+(700-h)/2,w,h)
 }
}
render("small-promo-440x280",440,280) {
 let icon=NSImage(contentsOfFile:"extension/icons/icon128.png")!
 icon.draw(in:rect(188,20,64,64))
 text("播客智能阅读助手",10,100,420,36,navy,true)
 text("让播客成为你的知识",10,161,420,24,red,true)
 text("阅读 · 理解 · 创作",10,219,420,17,navy,true)
}
