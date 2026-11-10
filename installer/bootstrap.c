/* Markpad's small, dependency-free Windows installer launcher.
 * Extracts only its own embedded PowerShell UI and ZIP to a unique temp directory.
 * Windows PowerShell/.NET are built into the supported Windows 10/11 desktop.
 * No downloaded scripts, administrator elevation, service, or background updater.
 */
typedef unsigned short WCHAR;
typedef unsigned long DWORD;
typedef int BOOL;
typedef void *HANDLE;
typedef unsigned long long U64;
typedef unsigned long long SIZE_T;
typedef struct { U64 value; } LARGE_INTEGER;
#define API __declspec(dllimport)
#define BAD_HANDLE ((HANDLE)(long long)-1)
API DWORD GetModuleFileNameW(HANDLE, WCHAR *, DWORD);
API DWORD GetCurrentProcessId(void);
API DWORD GetTempPathW(DWORD, WCHAR *);
API DWORD GetSystemDirectoryW(WCHAR *, DWORD);
API BOOL CreateDirectoryW(const WCHAR *, void *);
API HANDLE CreateFileW(const WCHAR *, DWORD, DWORD, void *, DWORD, DWORD, HANDLE);
API BOOL GetFileSizeEx(HANDLE, LARGE_INTEGER *);
API BOOL SetFilePointerEx(HANDLE, LARGE_INTEGER, LARGE_INTEGER *, DWORD);
API BOOL ReadFile(HANDLE, void *, DWORD, DWORD *, void *);
API BOOL WriteFile(HANDLE, const void *, DWORD, DWORD *, void *);
API BOOL CloseHandle(HANDLE);
API BOOL DeleteFileW(const WCHAR *);
API BOOL RemoveDirectoryW(const WCHAR *);
API DWORD WaitForSingleObject(HANDLE, DWORD);
API BOOL GetExitCodeProcess(HANDLE, DWORD *);
API void ExitProcess(DWORD);
API int MessageBoxW(HANDLE, const WCHAR *, const WCHAR *, unsigned int);
API long BCryptGenRandom(HANDLE, unsigned char *, DWORD, DWORD);
typedef struct {
 DWORD cb; WCHAR *reserved; WCHAR *desktop; WCHAR *title;
 DWORD x,y,xsize,ysize,xchars,ychars,fill,flags;
 unsigned short show,reserved2; unsigned char *reservedptr;
 HANDLE in,out,err;
} STARTUPINFO;
typedef struct { HANDLE process,thread; DWORD pid,tid; } PROCESSINFO;
API BOOL CreateProcessW(const WCHAR *, WCHAR *, void *, void *, BOOL, DWORD, void *, const WCHAR *, STARTUPINFO *, PROCESSINFO *);
static WCHAR self[32768], temp[32768], script[32768], archive[32768], command[32768], ps[32768];
static unsigned char buffer[65536], footer[32], randomBytes[16];
static STARTUPINFO startup;
static PROCESSINFO process;
static HANDLE input = BAD_HANDLE;
static int createdTemp = 0, createdScript = 0, createdArchive = 0;
static unsigned int len(const WCHAR *s) { unsigned int n=0; while(s[n])n++; return n; }
static int append(WCHAR *to, const WCHAR *text) {
 unsigned int n=len(to), i=0; if(n+len(text)>=32767)return 0;
 while(text[i]){to[n+i]=text[i];i++;}to[n+i]=0;return 1;
}
static void cleanup(void) {
 if(input!=BAD_HANDLE)CloseHandle(input);
 if(createdScript)DeleteFileW(script);
 if(createdArchive)DeleteFileW(archive);
 if(createdTemp)RemoveDirectoryW(temp);
}
static void fail(const WCHAR *message) {
 MessageBoxW(0,message,L"Markpad Setup",0x10);cleanup();ExitProcess(1);
}
static int extract(U64 at, U64 length, const WCHAR *name, int *created) {
 LARGE_INTEGER where; where.value=at;
 if(!SetFilePointerEx(input,where,0,0))return 0;
 HANDLE output=CreateFileW(name,0x40000000,0,0,1,0x80,0);
 if(output==BAD_HANDLE)return 0; *created=1;
 while(length){DWORD want=length>sizeof(buffer)?sizeof(buffer):(DWORD)length, got=0,written=0;
  if(!ReadFile(input,buffer,want,&got,0)||got!=want||!WriteFile(output,buffer,got,&written,0)||written!=got){CloseHandle(output);return 0;}
  length-=got;
 }
 CloseHandle(output);return 1;
}
void mainCRTStartup(void) {
 LARGE_INTEGER total,at; DWORD read=0,exitCode=1; U64 scriptBytes=0,zipBytes=0;
 unsigned int i,n; static const unsigned char magic[16]={'M','A','R','K','P','A','D','S','E','T','U','P','v','1',0,0};
 n=GetModuleFileNameW(0,self,32768); if(!n||n>=32767)fail(L"Could not locate this installer.");
 input=CreateFileW(self,0x80000000,1,0,3,0x80,0);
 if(input==BAD_HANDLE||!GetFileSizeEx(input,&total)||total.value<32)fail(L"Could not read this installer.");
 at.value=total.value-32;
 if(!SetFilePointerEx(input,at,0,0)||!ReadFile(input,footer,32,&read,0)||read!=32)fail(L"The installer is incomplete. Download it again.");
 for(i=0;i<16;i++)if(footer[i]!=magic[i])fail(L"The installer payload is missing or incomplete.");
 for(i=0;i<8;i++){scriptBytes|=((U64)footer[16+i])<<(8*i);zipBytes|=((U64)footer[24+i])<<(8*i);}
 if(!scriptBytes||scriptBytes>2*1024*1024||zipBytes>2ULL*1024*1024*1024||scriptBytes+zipBytes+32>total.value)fail(L"Invalid installer payload size.");
 n=GetTempPathW(32768,temp); if(!n||n>32000)fail(L"Could not find a writable temporary folder.");
 if(BCryptGenRandom(0,randomBytes,16,2)<0)fail(L"Could not create a secure temporary folder.");
 append(temp,L"MarkpadSetup-");n=len(temp);
 for(i=0;i<16;i++){temp[n++]=L"0123456789abcdef"[randomBytes[i]>>4];temp[n++]=L"0123456789abcdef"[randomBytes[i]&15];}temp[n]=0;
 if(!CreateDirectoryW(temp,0))fail(L"Could not create the temporary setup folder.");createdTemp=1;
 append(script,temp);append(script,L"\\setup.ps1");append(archive,temp);append(archive,L"\\payload.zip");
 if(!extract(total.value-32-zipBytes-scriptBytes,scriptBytes,script,&createdScript))fail(L"Could not extract the setup program.");
 if(zipBytes&&!extract(total.value-32-zipBytes,zipBytes,archive,&createdArchive))fail(L"Could not extract the application files. Check available disk space.");
 CloseHandle(input);input=BAD_HANDLE;
 n=GetSystemDirectoryW(ps,32768);if(!n||n>32000)fail(L"Could not find Windows PowerShell.");
 append(ps,L"\\WindowsPowerShell\\v1.0\\powershell.exe");
 if(!append(command,L"\"")||!append(command,ps)||!append(command,L"\" -NoLogo -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File \"")||!append(command,script)||!append(command,L"\" -BootstrapPath \"")||!append(command,self)||!append(command,L"\" -PayloadPath \"")||!append(command,archive)||!append(command,L"\""))fail(L"The setup path is too long.");
 append(command,L" -LauncherPid ");
 { DWORD value=GetCurrentProcessId(), divisor=1000000000; WCHAR digit[2]; digit[1]=0;
   while(divisor>1&&value<divisor)divisor/=10;
   while(divisor){digit[0]=(WCHAR)(L'0'+value/divisor);append(command,digit);value%=divisor;divisor/=10;}
 }
 startup.cb=sizeof(startup);startup.flags=1;startup.show=0;
 if(!CreateProcessW(ps,command,0,0,0,0x08000000,0,temp,&startup,&process))fail(L"Windows PowerShell could not start. Markpad Setup requires Windows PowerShell 5.1 and .NET Framework.");
 CloseHandle(process.thread);WaitForSingleObject(process.process,0xffffffff);GetExitCodeProcess(process.process,&exitCode);CloseHandle(process.process);
 cleanup();ExitProcess(exitCode);
}
