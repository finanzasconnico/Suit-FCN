' ============================================================================
'  Aviso mensual de liquidez  ·  macro para la versión .docm (envío de un clic)
' ============================================================================
'  CÓMO ARMAR EL .docm (una sola vez, lo hace Nico):
'   1. Abrí Aviso-liquidez.docx  ->  Archivo -> Guardar como -> tipo
'      "Documento habilitado con macros de Word (*.docm)" -> Aviso-liquidez.docm
'   2. Alt+F11 (editor de VBA) -> doble clic en "ThisDocument" (o Insertar -> Módulo)
'   3. Pegá TODO este archivo -> Guardá (Ctrl+S) -> cerrá el editor.
'   4. Listo. Cada vez que se abre el .docm y se habilita el contenido,
'      pregunta si enviar y hace la combinación solo.
'
'  FLUJO DEL ASESOR:  abrir Aviso-liquidez.docm  ->  "Habilitar contenido"
'                     ->  responder "Sí" al cartel  ->  enviados.
' ============================================================================

Option Explicit

Private Const ASUNTO As String = "Tenés dinero sin invertir en tu cuenta de Balanz"

Sub AutoOpen()
    EnviarAviso
End Sub

Sub EnviarAviso()
    Dim csvPath As String, esPrueba As Boolean
    csvPath = BuscarCSV(esPrueba)

    If csvPath = "" Then
        MsgBox "No encontré 'aviso-liquidez.csv' en Descargas." & vbCrLf & vbCrLf & _
               "Generá el archivo desde la Suite (botón 'Notificar a todos por mail') y volvé a abrir este documento.", _
               vbExclamation, "Aviso de liquidez"
        Exit Sub
    End If

    Dim rc As Long
    With ActiveDocument.MailMerge
        .MainDocumentType = wdEMail
        On Error Resume Next
        .OpenDataSource Name:=csvPath, ConfirmConversions:=False, ReadOnly:=True, _
                        LinkToSource:=False, AddToRecentFiles:=False, Format:=wdOpenFormatText
        On Error GoTo 0
        If .DataSource Is Nothing Then
            MsgBox "No pude leer el archivo de datos." & vbCrLf & csvPath, vbCritical, "Aviso de liquidez"
            Exit Sub
        End If
        .ActiveRecord = wdLastRecord
        rc = .DataSource.ActiveRecord
        .ActiveRecord = wdFirstRecord

        Dim msg As String
        msg = "Se van a enviar " & rc & " correos individuales desde tu Outlook" & vbCrLf & _
              "(uno por cliente, nunca en copia)."
        If esPrueba Then msg = "MODO PRUEBA" & vbCrLf & vbCrLf & msg
        msg = msg & vbCrLf & vbCrLf & "Archivo: " & csvPath & vbCrLf & vbCrLf & "¿Enviar ahora?"

        If MsgBox(msg, vbYesNo + vbQuestion, "Aviso de liquidez") <> vbYes Then Exit Sub

        .Destination = wdSendToEmail
        .MailAddressFieldName = "Email"
        .MailSubject = ASUNTO
        .MailFormat = wdMailFormatHTML
        .SuppressBlankLines = True
        .Execute Pause:=False
    End With

    MsgBox "Listo. Word le pasó los " & rc & " correos a Outlook." & vbCrLf & _
           "Revisá la carpeta 'Elementos enviados' de tu cuenta corporativa.", _
           vbInformation, "Aviso de liquidez"
End Sub

' Busca el CSV en Descargas / Downloads. Si existe el de PRUEBA, pregunta cuál usar.
Private Function BuscarCSV(ByRef esPrueba As Boolean) As String
    Dim base As String, i As Integer
    Dim carpetas() As String
    carpetas = Split(Environ$("USERPROFILE") & "\Downloads|" & Environ$("USERPROFILE") & "\Descargas", "|")

    Dim real As String, prueba As String
    For i = 0 To UBound(carpetas)
        If real = "" And Dir(carpetas(i) & "\aviso-liquidez.csv") <> "" Then real = carpetas(i) & "\aviso-liquidez.csv"
        If prueba = "" And Dir(carpetas(i) & "\aviso-liquidez-PRUEBA.csv") <> "" Then prueba = carpetas(i) & "\aviso-liquidez-PRUEBA.csv"
    Next i

    esPrueba = False
    If prueba <> "" And real <> "" Then
        If MsgBox("Encontré el archivo de PRUEBA." & vbCrLf & vbCrLf & _
                  "SÍ  = usar la PRUEBA (mails a tu casilla)" & vbCrLf & _
                  "NO = usar el archivo real (mails a los clientes)", _
                  vbYesNo + vbQuestion, "Aviso de liquidez") = vbYes Then
            esPrueba = True: BuscarCSV = prueba
        Else
            BuscarCSV = real
        End If
    ElseIf prueba <> "" Then
        esPrueba = True: BuscarCSV = prueba
    Else
        BuscarCSV = real
    End If
End Function
