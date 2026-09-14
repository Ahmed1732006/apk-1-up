import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=process.cwd(), app=join(root,'android/app'), gradle=join(app,'build.gradle');
if(!existsSync(app)) throw new Error('Android project missing');
let g=readFileSync(gradle,'utf8');
g=g.replace(/minSdkVersion\s+28/g,'minSdkVersion 26').replace(/\n\s*implementation "androidx\.pdf:pdf-viewer-fragment:1\.0\.0-beta01"\n/g,'\n');
writeFileSync(gradle,g);
const dir=join(app,'src/main/java/com/inthevoid/platform'); mkdirSync(dir,{recursive:true});
const java=`package com.inthevoid.platform;
import android.content.Context;import android.graphics.*;import android.graphics.pdf.PdfRenderer;import android.net.Uri;import android.os.*;import android.view.*;import android.widget.*;import androidx.appcompat.app.AppCompatActivity;import java.io.*;import java.util.*;
public class PdfViewerActivity extends AppCompatActivity{
 PdfView v; TextView pages;
 int dp(int x){return Math.round(x*getResources().getDisplayMetrics().density);}
 @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(Color.rgb(3,10,20));getWindow().setNavigationBarColor(Color.BLACK);
  FrameLayout r=new FrameLayout(this);r.setBackgroundColor(Color.rgb(18,18,18));
  FrameLayout bar=new FrameLayout(this);bar.setBackgroundColor(Color.rgb(3,10,20));
  ImageButton x=new ImageButton(this);x.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);x.setBackgroundColor(Color.TRANSPARENT);x.setColorFilter(Color.WHITE);x.setOnClickListener(q->finish());FrameLayout.LayoutParams xp=new FrameLayout.LayoutParams(dp(56),dp(56));xp.gravity=Gravity.START;bar.addView(x,xp);
  TextView title=new TextView(this);title.setId(1001);title.setTextColor(Color.WHITE);title.setTextSize(16);title.setGravity(Gravity.CENTER_VERTICAL);title.setText("PDF");FrameLayout.LayoutParams tp=new FrameLayout.LayoutParams(-1,dp(56));tp.leftMargin=dp(56);tp.rightMargin=dp(90);bar.addView(title,tp);
  pages=new TextView(this);pages.setTextColor(Color.LTGRAY);pages.setTextSize(13);pages.setGravity(Gravity.CENTER);FrameLayout.LayoutParams pp=new FrameLayout.LayoutParams(dp(90),dp(56));pp.gravity=Gravity.END;bar.addView(pages,pp);r.addView(bar,new FrameLayout.LayoutParams(-1,dp(56)));
  v=new PdfView(this);FrameLayout.LayoutParams vp=new FrameLayout.LayoutParams(-1,-1);vp.topMargin=dp(56);r.addView(v,vp);setContentView(r);
  String p=getIntent().getStringExtra("pdf_path");if(p==null)p=getIntent().getStringExtra("pdfFile");String n=getIntent().getStringExtra("filename");if(n==null)n=getIntent().getStringExtra("EXTRA_PDF_FILE_NAME");if(n==null)n=getIntent().getStringExtra("title");title.setText(n==null?"PDF":n);
  if(p==null){error("لم يتم العثور على ملف PDF");return;}try{Uri u=Uri.parse(p);if(!"file".equalsIgnoreCase(u.getScheme()))throw new IOException("مسار PDF غير صالح");File f=new File(u.getPath());if(!f.isFile()||f.length()==0)throw new IOException("ملف PDF غير موجود أو فارغ");v.open(f);}catch(Throwable e){error(e.getMessage()==null?"تعذر فتح ملف PDF":e.getMessage());}
 }
 void error(String s){TextView e=new TextView(this);e.setText("تعذر عرض ملف PDF\\n\\n"+s);e.setTextColor(Color.WHITE);e.setTextSize(16);e.setGravity(Gravity.CENTER);e.setPadding(dp(24),dp(24),dp(24),dp(24));e.setBackgroundColor(Color.rgb(28,28,28));FrameLayout.LayoutParams p=new FrameLayout.LayoutParams(-1,-1);p.topMargin=dp(56);addContentView(e,p);}
 class PdfView extends View{
  Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG),shade=new Paint();PdfRenderer rr;ParcelFileDescriptor fd;Map<Integer,Bitmap> cache=new HashMap<>();ScaleGestureDetector scale;GestureDetector gesture;float zoom=1f,sx,sy,gap;int[] pw,ph;float[] top;float bw;
  PdfView(Context c){super(c);setBackgroundColor(Color.rgb(18,18,18));gap=dp(12);scale=new ScaleGestureDetector(c,new ScaleGestureDetector.SimpleOnScaleGestureListener(){public boolean onScale(ScaleGestureDetector d){float old=zoom,n=Math.max(1f,Math.min(4f,zoom*d.getScaleFactor()));if(n==old)return true;float fy=sy+d.getFocusY();zoom=n;sy=fy-d.getFocusY();clamp();invalidate();return true;}});gesture=new GestureDetector(c,new GestureDetector.SimpleOnGestureListener(){public boolean onDown(MotionEvent e){return true;}public boolean onScroll(MotionEvent a,MotionEvent b,float dx,float dy){sx+=dx;sy+=dy;clamp();invalidate();return true;}public boolean onFling(MotionEvent a,MotionEvent b,float vx,float vy){sx-=vx*.18f;sy-=vy*.18f;clamp();invalidate();return true;}});}
  void open(File f)throws IOException{close();fd=ParcelFileDescriptor.open(f,ParcelFileDescriptor.MODE_READ_ONLY);rr=new PdfRenderer(fd);int n=rr.getPageCount();if(n<1)throw new IOException("ملف PDF لا يحتوي على صفحات");pw=new int[n];ph=new int[n];top=new float[n];float m=0;for(int i=0;i<n;i++){PdfRenderer.Page p=rr.openPage(i);pw[i]=p.getWidth();ph[i]=p.getHeight();m=Math.max(m,pw[i]);p.close();}bw=Math.min(m,1200);for(int i=1;i<n;i++)top[i]=top[i-1]+h0(i-1)+gap;pages.setText(n+" صفحة");invalidate();}
  float h0(int i){return bw*((float)ph[i]/Math.max(1,pw[i]));}float w(int i){return bw*zoom;}float h(int i){return h0(i)*zoom;}float y(int i){return top[i]*zoom+i*gap;}float total(){int n=rr==null?0:rr.getPageCount();return n==0?0:y(n-1)+h(n-1)+gap;}
  protected void onDraw(Canvas c){super.onDraw(c);if(rr==null)return;int n=rr.getPageCount();float vw=getWidth(),vh=getHeight();for(int i=0;i<n;i++){float yy=y(i)-sy,ww=w(i),hh=h(i),xx=(vw-ww)/2-sx;if(yy+hh<0||yy>vh||xx+ww<0||xx>vw)continue;shade.setColor(Color.rgb(55,55,55));c.drawRect(xx+dp(2),yy+dp(2),xx+ww+dp(2),yy+hh+dp(2),shade);Bitmap b=bitmap(i,Math.min(1600,Math.max(1,Math.round(ww))));if(b!=null)c.drawBitmap(b,null,new RectF(xx,yy,xx+ww,yy+hh),paint);}}
  Bitmap bitmap(int i,int req){Bitmap b=cache.get(i);if(b!=null&&!b.isRecycled()&&b.getWidth()>=Math.min(req,1200))return b;try{PdfRenderer.Page p=rr.openPage(i);int w=Math.max(1,Math.min(req,1600)),h=Math.max(1,Math.round((float)w*ph[i]/Math.max(1,pw[i])));b=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);b.eraseColor(Color.WHITE);p.render(b,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);p.close();Bitmap old=cache.put(i,b);if(old!=null&&!old.isRecycled())old.recycle();while(cache.size()>5){Integer k=cache.keySet().iterator().next();if(k==i)break;Bitmap z=cache.remove(k);if(z!=null&&!z.isRecycled())z.recycle();}return b;}catch(Throwable e){return null;}}
  void clamp(){if(rr==null)return;float my=Math.max(0,total()-getHeight()),mx=Math.max(0,bw*zoom-getWidth());if(zoom<=1.01f)sx=0;else sx=Math.max(-mx/2,Math.min(mx/2,sx));sy=Math.max(0,Math.min(my,sy));}
  public boolean onTouchEvent(MotionEvent e){scale.onTouchEvent(e);gesture.onTouchEvent(e);return true;}
  void close(){for(Bitmap b:cache.values())if(b!=null&&!b.isRecycled())b.recycle();cache.clear();if(rr!=null)try{rr.close();}catch(Exception e){}if(fd!=null)try{fd.close();}catch(Exception e){}rr=null;fd=null;}
  protected void onDetachedFromWindow(){close();super.onDetachedFromWindow();}
 }
}`;
writeFileSync(join(dir,'PdfViewerActivity.java'),java);console.log('Android 8-compatible PDF viewer applied');
