import React from 'react'

interface Props {
  children: React.ReactNode
}
interface State {
  hasError: boolean
  error: string
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', color: '#e8eaed',
          fontFamily: 'Inter, sans-serif', gap: 16, padding: 40
        }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Произошла ошибка</div>
          <div style={{ fontSize: 12, color: '#8b949e', textAlign: 'center', maxWidth: 400 }}>
            {this.state.error}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: '' })}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: 'rgba(88,166,255,0.2)', color: '#58a6ff',
              cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 13
            }}
          >
            Перезагрузить UI
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
