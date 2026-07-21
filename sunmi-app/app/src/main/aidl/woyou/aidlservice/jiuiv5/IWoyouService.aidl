package woyou.aidlservice.jiuiv5;

import woyou.aidlservice.jiuiv5.ICallback;

interface IWoyouService {
    void printerInit(in ICallback callback);
    void setAlignment(int alignment, in ICallback callback);
    void setFontSize(float fontsize, in ICallback callback);
    void printText(String text, in ICallback callback);
    void printTextWithFont(String text, String typeface, float fontsize, in ICallback callback);
    void printColumnsString(in String[] colsTextArr, in int[] colsWidthArr, in int[] colsAlign, in ICallback callback);
    void lineWrap(int n, in ICallback callback);
    void cutPaper(in ICallback callback);
    void openDrawer(in ICallback callback);
    void sendRAWData(in byte[] data, in ICallback callback);
    int updatePrinterState();
}
