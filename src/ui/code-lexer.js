/** Offline, deterministic color tokens for fenced Markdown code. */
const LANGUAGE_NAMES = new Map(Object.entries({
  c:'c',h:'c',cpp:'cpp','c++':'cpp',cxx:'cpp',hpp:'cpp',cc:'cpp',
  cs:'csharp',csharp:'csharp','c#':'csharp',js:'javascript',jsx:'javascript',javascript:'javascript',
  ts:'typescript',tsx:'typescript',typescript:'typescript',py:'python',python:'python',
  json:'json',css:'css',html:'html',xml:'html',sh:'bash',bash:'bash',shell:'bash',
  sql:'sql',java:'java',go:'go',rust:'rust',rs:'rust',rb:'ruby',ruby:'ruby',
}));
const C_KEYWORDS = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local';
const CPP_KEYWORDS = `${C_KEYWORDS} alignas alignof and asm bool catch class constexpr consteval constinit decltype delete dynamic_cast explicit export false friend mutable namespace new noexcept nullptr operator or override private protected public reinterpret_cast requires static_assert static_cast template this thread_local throw true try typeid typename using virtual wchar_t`; 
const KEYWORDS = {
  c:C_KEYWORDS,cpp:CPP_KEYWORDS,csharp:'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield',
  javascript:'async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
  typescript:'abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let module namespace never new null number object of private protected public readonly require return set static string super switch symbol this throw true try type unknown var void while yield',
  python:'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda nonlocal not None or pass raise return True try while with yield',
  json:'true false null',css:'important inherit initial unset revert from to',
  html:'doctype html head body script style div span main section article img a p h1 h2 h3',
  bash:'case do done elif else esac fi for function if in then until while',
  sql:'and as asc between by case cast coalesce create cross delete desc distinct drop else end exists false from full group having in inner insert into is join left like limit not null on or order outer primary right select set table then true union unique update values when where',
  java:'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while',
  go:'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  rust:'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  ruby:'BEGIN END alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield'
};
const KEYWORD_SETS = Object.fromEntries(Object.entries(KEYWORDS).map(([k,v])=>[k,new Set(v.split(/\s+/))]));
const COMMON_TYPES = new Set(['uint8_t','uint16_t','uint32_t','uint64_t','int8_t','int16_t','int32_t','int64_t','size_t','ssize_t','FILE','NULL','std','String','Array','Object','Number','Boolean','List','Dict','Optional']);

/** Returns disjoint [start, end, class] token ranges in the string. */
export function tokenizeCode(text, language) {
  const lang = LANGUAGE_NAMES.get(String(language || '').toLowerCase());
  if (!lang || !text) return [];
  const tokens = [];
  const kw = KEYWORD_SETS[lang] || new Set();
  const cLike = !['python','bash','ruby','sql'].includes(lang);
  let i = 0;
  const add = (end, type) => { if(end > i)tokens.push({start:i,end,type}); i=end; };
  while (i < text.length) {
    const tail = text.slice(i);
    let match;
    // Preprocessor lines and comments must win over operator/identifier matching.
    if ((lang === 'c' || lang === 'cpp') && (i === 0 || text[i-1] === '\n') && (match = /^(\s*#[ \t]*(?:include|define|ifdef|ifndef|if|else|elif|endif|pragma|undef|error|warning|line)\b[^\n]*)/.exec(tail))) {
      add(i + match[0].length, 'preprocessor'); continue;
    }
    if (cLike && tail.startsWith('//')) { add(i + (tail.indexOf('\n') < 0 ? tail.length : tail.indexOf('\n')), 'comment'); continue; }
    if (cLike && tail.startsWith('/*')) { const end=tail.indexOf('*/',2);add(i+(end < 0 ? tail.length : end+2),'comment');continue; }
    if (['python','bash','ruby'].includes(lang) && tail[0] === '#') { add(i+(tail.indexOf('\n')<0?tail.length:tail.indexOf('\n')),'comment');continue; }
    if (tail[0] === '"' || tail[0] === "'" || tail[0] === '`') {
      const quote=tail[0];let j=1;
      while(j<tail.length){if(tail[j]==='\\'){j+=2;continue;}if(tail[j]===quote){j++;break;}j++;}
      add(i+j,'string'); continue;
    }
    if (match=/^(?:0[xX][\da-fA-F]+|0[bB][01]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)(?:[uUlLfF]+)?\b/.exec(tail)) { add(i+match[0].length,'number');continue; }
    if (match=/^[A-Za-z_$][A-Za-z\d_$]*/.exec(tail)) {
      const word=match[0],end=i+word.length;
      if (kw.has(word)) add(end,'keyword');
      else if (COMMON_TYPES.has(word) || /^[A-Z][A-Za-z0-9_]*_t$/.test(word)) add(end,'type');
      else if (/^\s*\(/.test(text.slice(end))) add(end,'function');
      else i=end;
      continue;
    }
    i++;
  }
  return tokens;
}

