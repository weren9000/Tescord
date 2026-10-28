import {isTextFile,prepareTextFile,safeTextFilename,textLength} from './text-files';
describe('Text file conversion',()=>{
  it('counts Unicode code points and the exact 2000 character boundary',()=>{
    for(const size of [1999,2000,2001])expect(textLength('я'.repeat(size))).toBe(size);
    expect(textLength('😀'.repeat(2000))).toBe(2000);
    expect(textLength('a\n ')).toBe(3);
  });
  it('preserves ordinary text, indentation and line endings byte for byte',()=>{
    const text='  Инструкция 😀\r\n\r\n'+('строка\r\n'.repeat(400))+'  ';
    expect(prepareTextFile(text)).toEqual({name:'message.md',content:text});
  });
  it('uses an explicit language and retains indentation inside a fenced block',()=>{
    expect(prepareTextFile('```python\nif True:\n    print("да")\n```')).toEqual({name:'snippet.py',content:'if True:\n    print("да")'});
    expect(prepareTextFile('```yaml\na: 1\n```').name).toBe('snippet.yaml');
  });
  it('preserves mixed prose with code as Markdown',()=>{
    const text='Инструкция\n```python\ndef f():\n    return 1\n```';
    expect(prepareTextFile(text)).toEqual({name:'message.md',content:text});
  });
  it('only recognizes valid JSON and avoids classifying prose as YAML',()=>{
    expect(prepareTextFile('{"a": [1, 2]}').name).toBe('data.json');
    expect(prepareTextFile('{"a": broken}').name).toBe('snippet.txt');
    expect(prepareTextFile('Имя: Иван\nГород: Москва').name).toBe('message.md');
    expect(prepareTextFile('---\nname: app\nservice:\n  port: 80').name).toBe('config.yaml');
    expect(prepareTextFile('services:\n  web:\n    image: nginx').name).toBe('config.yaml');
  });
  it('recognizes distinctive Python and log structures',()=>{
    expect(prepareTextFile('def hello():\n    return 1').name).toBe('snippet.py');
    expect(prepareTextFile('2026-10-22 INFO ready\n2026-10-22 ERROR offline').name).toBe('output.log');
  });
  it('restricts text previews and removes path separators in generated names',()=>{
    expect(isTextFile('image.png')).toBeFalse();expect(isTextFile('config.YAML')).toBeTrue();
    expect(safeTextFilename('../a\\b.py')).toBe('.._a_b.py');
  });
});
