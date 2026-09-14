import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const p=join(process.cwd(),'android','app','src','main','java','com','inthevoid','platform','PdfViewerActivity.java');
if(!existsSync(p)) throw new Error('PdfViewerActivity.java missing');
let s=readFileSync(p,'utf8');
s=s.replace(/import android\.view\.ViewConfiguration;\n/,'');
s=s.replace(/private PdfPageView pageView;/,'private PdfDocumentView pageView;');
s=s.replace(/pageView = new PdfPageView\(\);/,'pageView = new PdfDocumentView();');
s=s.replace(/\s*pageView\.setPageChangedListener\(p => \{ currentPage = p; updateLabel\(\); \}\);\n            pageView\.loadPage\(\);/,'\n            pageView.loadDocument();');
const start=s.indexOf('    private class PdfPageView extends View {');
if(start<0) throw new Error('PdfPageView not found');
const end=s.indexOf('\n    }\n}\n`);',start);
if(end<0) throw new Error('viewer class end not found');
const cls=`    private class PdfDocumentView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final ScaleGestureDetector scaleDetector;
        private final GestureDetector gestureDetector;
        private final java.util.concurrent.ExecutorService executor = java.util.concurrent.Executors.newSingleThreadExecutor();
        private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
        private final java.util.Map<Integer, Bitmap> cache = new java.util.HashMap<>();
        private final java.util.Set<Integer> loading = new java.util.HashSet<>();
        private float[] widths, heights;
        private float fitScale=1f, scale=1f, scrollY=0f, offsetX=0f, lastX, lastY, lastFocusX, lastFocusY;
        private boolean ready=false, scaling=false, stopped=false;

        PdfDocumentView() {
            super(PdfViewerActivity.this);
            setBackgroundColor(Color.rgb(25,32,42));
            scaleDetector = new ScaleGestureDetector(PdfViewerActivity.this,new ScaleGestureDetector.SimpleOnScaleGestureListener(){
                @Override public boolean onScaleBegin(ScaleGestureDetector d){ scaling=true; lastFocusX=d.getFocusX(); lastFocusY=d.getFocusY(); getParent().requestDisallowInterceptTouchEvent(true); return true; }
                @Override public boolean onScale(ScaleGestureDetector d){
                    if(!ready)return true;
                    float old=scale,next=Math.max(fitScale,Math.min(5f,old*d.getScaleFactor()));
                    if(Math.abs(next-old)<0.0005f)return true;
                    float docY=(scrollY+lastFocusY)/old;
                    float contentX=(lastFocusX-centeredLeft(old)-offsetX)/old;
                    scale=next; scrollY=docY*scale-lastFocusY; offsetX=lastFocusX-centeredLeft(scale)-contentX*scale; clamp();
                    lastFocusX=d.getFocusX(); lastFocusY=d.getFocusY(); invalidate(); return true;
                }
                @Override public void onScaleEnd(ScaleGestureDetector d){scaling=false;getParent().requestDisallowInterceptTouchEvent(false);}
            });
            gestureDetector = new GestureDetector(PdfViewerActivity.this,new GestureDetector.SimpleOnGestureListener(){
                @Override public boolean onDown(MotionEvent e){lastX=e.getX();lastY=e.getY();return true;}
                @Override public boolean onDoubleTap(MotionEvent e){if(!ready)return true;float t=scale<fitScale*1.5f?Math.min(5f,fitScale*2.2f):fitScale;zoomTo(t,e.getX(),e.getY());return true;}
            });
        }
        void loadDocument(){ post(()->{try{
            widths=new float[pageCount]; heights=new float[pageCount];
            for(int i=0;i<pageCount;i++){PdfRenderer.Page pg=renderer.openPage(i);widths[i]=Math.max(1,pg.getWidth());heights[i]=Math.max(1,pg.getHeight());pg.close();}
            ready=true;fitScale=Math.max(0.05f,Math.min(1f,(getWidth()-dp(18))/maxWidth()));scale=fitScale;scrollY=0;offsetX=0;invalidate();
        }catch(Exception e){ready=false;Toast.makeText(PdfViewerActivity.this,"تعذر تجهيز صفحات PDF",Toast.LENGTH_LONG).show();}}); }
        private float maxWidth(){float m=1;for(float w:widths)m=Math.max(m,w);return m;}
        private float gap(){return dp(12);}
        private float h(int i,float s){return heights[i]*s;}
        private float top(int i,float s){float y=gap();for(int n=0;n<i;n++)y+=h(n,s)+gap();return y;}
        private float totalH(float s){float y=gap();for(int i=0;i<pageCount;i++)y+=h(i,s)+gap();return y;}
        private float centeredLeft(float s){return(getWidth()-maxWidth()*s)/2f;}
        private float maxPanX(){return Math.max(0,(maxWidth()*scale-getWidth())/2f);}
        private void clamp(){scrollY=Math.max(0,Math.min(Math.max(0,totalH(scale)-getHeight()),scrollY));float m=maxPanX();offsetX=Math.max(-m,Math.min(m,offsetX));}
        private void zoomTo(float next,float fx,float fy){float old=scale;if(Math.abs(next-old)<.0005f)return;float docY=(scrollY+fy)/old;float cx=(fx-centeredLeft(old)-offsetX)/old;scale=next;scrollY=docY*scale-fy;offsetX=fx-centeredLeft(scale)-cx*scale;clamp();invalidate();}
        private void requestPage(int i){if(i<0||i>=pageCount||cache.containsKey(i)||loading.contains(i)||stopped)return;loading.add(i);final int tw=Math.min(1800,Math.max(dp(900),getWidth()*2));executor.execute(()->{Bitmap b=null;try{PdfRenderer.Page pg=renderer.openPage(i);float r=pg.getHeight()/(float)Math.max(1,pg.getWidth());int th=Math.max(dp(900),(int)(tw*r));b=Bitmap.createBitmap(tw,th,Bitmap.Config.ARGB_8888);b.eraseColor(Color.WHITE);pg.render(b,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);pg.close();}catch(Exception e){if(b!=null&&!b.isRecycled())b.recycle();b=null;}final Bitmap out=b;main.post(()->{loading.remove(i);if(out!=null&&!stopped){Bitmap old=cache.put(i,out);if(old!=null&&!old.isRecycled())old.recycle();invalidate();}else if(out!=null&&!out.isRecycled())out.recycle();});});}
        @Override protected void onDraw(Canvas c){super.onDraw(c);if(!ready)return;float y=gap()-scrollY;int first=0;for(int i=0;i<pageCount;i++){float ph=h(i,scale);if(y+ph>=0){first=i;break;}y+=ph+gap();}for(int i=Math.max(0,first-1);i<Math.min(pageCount,first+6);i++)requestPage(i);y=gap()-scrollY;for(int i=0;i<pageCount;i++){float ph=h(i,scale);if(y+ph>=0&&y<=getHeight()){float left=(getWidth()-widths[i]*scale)/2f+offsetX;RectF d=new RectF(left,y,left+widths[i]*scale,y+ph);Bitmap b=cache.get(i);paint.setColor(Color.WHITE);if(b!=null&&!b.isRecycled())c.drawBitmap(b,null,d,paint);else c.drawRect(d,paint);updatePageLabel(i);}y+=ph+gap();if(y>getHeight()&&i>first+5)break;}}
        @Override public boolean onTouchEvent(MotionEvent e){int a=e.getActionMasked();scaleDetector.onTouchEvent(e);gestureDetector.onTouchEvent(e);if(a==MotionEvent.ACTION_DOWN){lastX=e.getX();lastY=e.getY();getParent().requestDisallowInterceptTouchEvent(true);}else if(a==MotionEvent.ACTION_MOVE&&!scaling&&e.getPointerCount()==1){float dx=e.getX()-lastX,dy=e.getY()-lastY;offsetX+=dx;scrollY-=dy;clamp();lastX=e.getX();lastY=e.getY();invalidate();}else if(a==MotionEvent.ACTION_UP||a==MotionEvent.ACTION_CANCEL)getParent().requestDisallowInterceptTouchEvent(false);return true;}
        void loadPage(){}
        void releaseBitmap(){shutdown();}
        void shutdown(){if(stopped)return;stopped=true;executor.shutdownNow();for(Bitmap b:cache.values())if(b!=null&&!b.isRecycled())b.recycle();cache.clear();loading.clear();}
        @Override protected void onSizeChanged(int w,int h,int ow,int oh){super.onSizeChanged(w,h,ow,oh);if(ready){float old=fitScale;fitScale=Math.max(.05f,Math.min(1f,(w-dp(18))/maxWidth()));if(scale<=old*1.001f)scale=fitScale;clamp();}}
    }`;
s=s.slice(0,start)+cls+s.slice(end+6);
writeFileSync(p,s,'utf8');
console.log('Vertical PDF viewer generated.');
