/**
 * Cost auto-fill patch.
 * In your Apps Script project, find the EXISTING `function onEdit(e){ ... }` and DELETE it,
 * then paste this whole block in its place. (Leave upsertMap / lookupMap as they are.)
 * Save, then run `refreshCosts` ONCE to fix every row you've already coded.
 *
 * After this: typing a Product Code on any Sales row auto-fills its Cost PP from the Product tab
 * (and still learns the SKU→code pairing). A cost you typed by hand (e.g. a B/C refund) is kept.
 */
function onEdit(e){
  try{
    var ss=e.source, sh=e.range.getSheet();
    if(sh.getName()!=='Sales') return;
    var row=e.range.getRow(), col=e.range.getColumn();
    if(row<3) return;
    var map=ss.getSheetByName('SKU Map');
    if(col===12){                                   // PRODUCT CODE edited
      var sku=sh.getRange(row,4).getValue(), code=String(e.range.getValue()||'');
      if(sku && code && map) upsertMap(map,String(sku),code);
      if(code) fillCost(ss,sh,row,code);
    } else if(col===4){                             // SKU edited
      var sku2=String(e.range.getValue()||''), codeCell=sh.getRange(row,12);
      if(sku2 && !codeCell.getValue() && map){ var f=lookupMap(map,sku2); if(f){ codeCell.setValue(f); fillCost(ss,sh,row,String(f)); } }
    }
  }catch(err){}
}
function fillCost(ss,sh,row,code){
  var m=sh.getRange(row,13), v=m.getValue();
  if(v!=='' && v!=null) return;                     // keep a hand-typed cost
  var c=costForCode(ss,code); if(c!=='') m.setValue(c);
}
function costForCode(ss,code){
  var p=ss.getSheetByName('Product'); if(!p||p.getLastRow()<2) return '';
  var d=p.getRange(2,2,p.getLastRow()-1,6).getValues();   // columns B..G (code..cost_pc)
  for(var i=0;i<d.length;i++){ if(String(d[i][0])===code) return Number(d[i][5])||0; }
  return '';
}
function refreshCosts(){                             // RUN ONCE — fills cost on every coded-but-blank row
  var ss=SpreadsheetApp.getActive(), sh=ss.getSheetByName('Sales'); if(sh.getLastRow()<3) return;
  var L=sh.getRange(3,12,sh.getLastRow()-2,1).getValues(), M=sh.getRange(3,13,sh.getLastRow()-2,1).getValues(), n=0;
  for(var i=0;i<L.length;i++){ var code=String(L[i][0]||''); if(code && (M[i][0]===''||M[i][0]==null)){ var c=costForCode(ss,code); if(c!==''){ sh.getRange(3+i,13).setValue(c); n++; } } }
  ss.toast(n+' costs filled from product codes');
}
/**
 * styleDashboard — full NA sales dashboard (v2).
 * Paste into the same Apps Script project, Save, run styleDashboard.
 * Rebuilds the Dashboard tab in place. Nothing else is touched.
 * Set the From/To dates (B4 / D4) to any range — every card + table re-filters.
 */
function styleDashboard(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var d=ss.getSheetByName('Dashboard');
  if(!d){ d=ss.insertSheet('Dashboard'); }
  d.clear(); d.setHiddenGridlines(true);
  var INK='#111111', GREEN='#0F6E42', RED='#B42318', CARD='#FFFFFF', LINE='#E2E2DE', MUT='#8A8A85', SUB='#4A4A46', DROP='#F0F0EE', SOFT='#FAFAF8';
  var MON='£#,##0.00', PCT='0%', NUM='#,##0', SOLID=SpreadsheetApp.BorderStyle.SOLID;
  var W=[200,95,130,100,115,130,120,110];
  for(var i=0;i<W.length;i++) d.setColumnWidth(i+1,W[i]);

  // banner
  d.getRange('A1:H1').merge().setValue('  NA  —  SALES DASHBOARD').setBackground(INK).setFontColor('#FFFFFF')
    .setFontSize(22).setFontWeight('bold').setFontFamily('Poppins').setVerticalAlignment('middle');
  d.setRowHeight(1,56);
  d.getRange('A2:H2').merge().setValue('  Not Another Wholesale · live delivery & margin tracker · orders sync in real-time')
    .setFontColor(MUT).setFontSize(10).setFontStyle('italic'); d.setRowHeight(2,22);

  // filter
  d.getRange('A4').setValue('  PERIOD').setFontColor(SUB).setFontWeight('bold').setFontSize(10).setVerticalAlignment('middle');
  d.getRange('B4').setValue(new Date(2026,10,1)).setNumberFormat('dd mmm yyyy').setBackground(DROP).setHorizontalAlignment('center').setBorder(true,true,true,true,false,false,LINE,SOLID).setFontWeight('bold');
  d.getRange('C4').setValue('→').setHorizontalAlignment('center').setFontColor(MUT);
  d.getRange('D4').setValue(new Date(2026,11,31)).setNumberFormat('dd mmm yyyy').setBackground(DROP).setHorizontalAlignment('center').setBorder(true,true,true,true,false,false,LINE,SOLID).setFontWeight('bold');
  d.getRange('E4:H4').merge().setValue('  change dates to slice any range — a day, a week, a month').setFontColor(MUT).setFontSize(9).setFontStyle('italic').setVerticalAlignment('middle');
  d.setRowHeight(4,26);

  var SF='Sales!$B$3:$B,">="&$B$4,Sales!$B$3:$B,"<="&$D$4';
  function card(row,col,label,formula,fmt,tone){
    d.getRange(row,col,1,2).merge().setValue('  '+label).setFontColor(MUT).setFontSize(9).setFontWeight('bold').setBackground(CARD).setVerticalAlignment('middle');
    var color = tone==='g'?GREEN : tone==='r'?RED : INK;
    d.getRange(row+1,col,2,2).merge().setFormula(formula).setNumberFormat(fmt).setFontSize(20).setFontWeight('bold').setFontColor(color).setBackground(CARD).setVerticalAlignment('middle').setHorizontalAlignment('left').setFontFamily('Poppins');
    d.getRange(row,col,3,2).setBorder(true,true,true,true,false,false,LINE,SOLID);
    d.getRange(row+1,col).setValue(' ');
  }
  [6,10,14].forEach(function(b){ d.setRowHeight(b,18); d.setRowHeight(b+1,24); d.setRowHeight(b+2,22); });

  card(6,1,'NET SALES','=SUMIFS(Sales!$J$3:$J,'+SF+')',MON,'');
  card(6,3,'PROFIT','=SUMIFS(Sales!$O$3:$O,'+SF+')',MON,'g');
  card(6,5,'MARGIN','=IFERROR(C7/A7,"")',PCT,'g');
  card(6,7,'ORDERS','=COUNTUNIQUEIFS(Sales!$A$3:$A,'+SF+')',NUM,'');
  card(10,1,'REVENUE (gross)','=SUMIFS(Sales!$H$3:$H,'+SF+')',MON,'');
  card(10,3,'TOTAL COST','=SUMIFS(Sales!$N$3:$N,'+SF+')',MON,'');
  card(10,5,'UNITS SOLD','=SUMIFS(Sales!$G$3:$G,'+SF+')',NUM,'');
  card(10,7,'AVG ORDER','=IFERROR(A7/G7,"")',MON,'');
  card(14,1,'DISCOUNT','=SUMIFS(Sales!$I$3:$I,'+SF+')',MON,'r');
  card(14,3,'SHIPPING','=SUMIFS(Sales!$K$3:$K,'+SF+')',MON,'');
  card(14,5,'ASSIGNED NET','=SUMIFS(Sales!$J$3:$J,Sales!$L$3:$L,"?*",'+SF+')',MON,'g');
  card(14,7,'UNASSIGNED NET','=A7-E15',MON,'r');

  var DT='B >= date \'"&TEXT($B$4,"yyyy-mm-dd")&"\' and B <= date \'"&TEXT($D$4,"yyyy-mm-dd")&"\'';
  function section(row,c1,t1,c2,t2){
    d.getRange(row,c1,1,4).merge().setValue('  '+t1).setBackground(INK).setFontColor('#FFFFFF').setFontWeight('bold').setFontFamily('Poppins').setFontSize(11).setVerticalAlignment('middle');
    if(t2){ d.getRange(row,c2,1,3).merge().setValue('  '+t2).setBackground(INK).setFontColor('#FFFFFF').setFontWeight('bold').setFontFamily('Poppins').setFontSize(11).setVerticalAlignment('middle'); }
    d.setRowHeight(row,26);
  }

  // Top products + By bale
  section(18,1,'TOP PRODUCTS  —  BY PROFIT',6,'BY BALE / CODE');
  d.getRange('A19').setFormula('=QUERY(Sales!$A$3:$P,"select C, sum(H), sum(J), sum(O) where '+DT+' and C is not null group by C order by sum(O) desc limit 12 label C \'Product\', sum(H) \'Revenue\', sum(J) \'Net\', sum(O) \'Profit\'",0)');
  d.getRange('F19').setFormula('=QUERY(Sales!$A$3:$P,"select L, sum(J), sum(O) where '+DT+' and L is not null group by L order by sum(O) desc label L \'Code\', sum(J) \'Net\', sum(O) \'Profit\'",0)');

  // By grade + Best / worst margin lines
  section(33,1,'BY GRADE  (A/B · B · B/C)',6,'DAILY');
  d.getRange('A34').setFormula('=QUERY(Sales!$A$3:$P,"select E, sum(G), sum(J), sum(O) where '+DT+' group by E order by sum(O) desc label E \'Grade\', sum(G) \'Units\', sum(J) \'Net\', sum(O) \'Profit\'",0)');
  d.getRange('F34').setFormula('=QUERY(Sales!$A$3:$P,"select B, sum(J), sum(O) where '+DT+' group by B order by B label B \'Day\', sum(J) \'Net\', sum(O) \'Profit\'",0)');

  // Needs attention
  section(45,1,'⚠ NEEDS ATTENTION  —  uncosted or loss-making lines',0,'');
  d.getRange('A46').setFormula('=IFERROR(QUERY(Sales!$A$3:$P,"select A, C, E, J, O, P where '+DT+' and (L is null or O < 0) order by O asc limit 15 label A \'Order\', C \'Product\', E \'Grade\', J \'Net\', O \'Profit\', P \'Margin\'",0),"— none — all costed and in profit —")');

  // ---- styling of query outputs ----
  function hdr(a1){ d.getRange(a1).setFontWeight('bold').setFontColor(SUB).setBorder(false,false,true,false,false,false,INK,SOLID); }
  hdr('A19:D19'); hdr('F19:H19'); hdr('A34:D34'); hdr('F34:H34'); hdr('A46:F46');
  d.getRange('B20:D31').setNumberFormat(MON); d.getRange('D20:D31').setFontColor(GREEN).setFontWeight('bold');
  d.getRange('G20:H31').setNumberFormat(MON); d.getRange('H20:H31').setFontColor(GREEN).setFontWeight('bold');
  d.getRange('B35:B44').setNumberFormat(NUM); d.getRange('C35:D44').setNumberFormat(MON); d.getRange('D35:D44').setFontColor(GREEN).setFontWeight('bold');
  d.getRange('F35:F80').setNumberFormat('dd mmm'); d.getRange('G35:H80').setNumberFormat(MON); d.getRange('H35:H80').setFontColor(GREEN).setFontWeight('bold');
  d.getRange('D47:D60').setNumberFormat(MON); d.getRange('E47:E60').setNumberFormat(MON); d.getRange('F47:F60').setNumberFormat(PCT);
  d.getRange('E47:E60').setFontColor(RED).setFontWeight('bold');

  d.setFrozenRows(4);
  ss.setActiveSheet(d);
  Logger.log('DASHBOARD v2 styled');
}
