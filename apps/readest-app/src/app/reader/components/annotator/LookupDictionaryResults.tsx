import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import type { DictionaryDisplayEntry } from '@/services/contextTranslation/types';

interface LookupDictionaryResultsProps {
  dictionaryResults: DictionaryDisplayEntry[];
  selectedText: string;
  onNavigateTerm: (term: string) => void;
}

function renderInlineContent(
  definition: string,
  entryIndex: number,
  onNavigateTerm: (term: string) => void,
  translate: (key: string, options?: Record<string, string>) => string,
): React.ReactNode {
  if (!definition.includes('<') || typeof document === 'undefined') {
    return definition;
  }

  const container = document.createElement('div');
  container.innerHTML = definition;

  const renderNode = (node: ChildNode, key: string): React.ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = node as HTMLElement;
    const children = Array.from(element.childNodes).map((child, index) => (
      <React.Fragment key={`${key}-${index}`}>
        {renderNode(child, `${key}-${index}`)}
      </React.Fragment>
    ));

    switch (element.tagName.toLowerCase()) {
      case 'a': {
        const target = (element.getAttribute('title') || element.textContent || '').trim();
        const label = (element.textContent || target).trim();
        if (!target) return label;
        return (
          <button
            type='button'
            className='not-eink:text-primary inline underline underline-offset-2'
            aria-label={translate('Look up {{term}}', { term: target })}
            onClick={() => onNavigateTerm(target)}
          >
            {label}
          </button>
        );
      }
      case 'strong':
      case 'b':
        return <strong>{children}</strong>;
      case 'em':
      case 'i':
        return <em>{children}</em>;
      case 'br':
        return <br />;
      default:
        return <span>{children}</span>;
    }
  };

  return Array.from(container.childNodes).map((node, index) => (
    <React.Fragment key={`dict-${entryIndex}-${index}`}>
      {renderNode(node, `dict-${entryIndex}-${index}`)}
    </React.Fragment>
  ));
}

const LookupDictionaryResults: React.FC<LookupDictionaryResultsProps> = ({
  dictionaryResults,
  selectedText,
  onNavigateTerm,
}) => {
  const _ = useTranslation();

  if (dictionaryResults.length === 0) return null;

  return (
    <details className='mb-2'>
      <summary className='cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-400'>
        {_('Dictionary')}
      </summary>
      <div className='mt-1 space-y-1 pl-2'>
        {dictionaryResults.map((entry, index) => {
          const canNavigateHeadword =
            entry.headword.trim() && entry.headword.trim() !== selectedText.trim();
          return (
            <div key={`${entry.headword}-${index}`} className='text-sm'>
              {canNavigateHeadword ? (
                <button
                  type='button'
                  className='not-eink:text-primary font-medium underline underline-offset-2'
                  aria-label={_('Look up {{term}}', { term: entry.headword })}
                  onClick={() => onNavigateTerm(entry.headword)}
                >
                  {entry.headword}
                </button>
              ) : (
                <span className='not-eink:text-white/95 font-medium'>{entry.headword}</span>
              )}
              <span className='not-eink:text-white/70 ml-1 whitespace-pre-wrap'>
                {renderInlineContent(entry.definition, index, onNavigateTerm, _)}
              </span>
              {entry.source && <span className='ml-1 text-xs text-gray-500'>({entry.source})</span>}
            </div>
          );
        })}
      </div>
    </details>
  );
};

export default LookupDictionaryResults;
