import axios from 'axios'

export const getTransactionDetails = async (
  resourceId: string
): Promise<{
  amount: number
  accountId: string
  kind: string
  counterpartyName: string | null
}> => {
  const res = await axios.get(`https://api.mercury.com/api/v1/transaction/${resourceId}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${process.env.BANK_TOKEN}`
    }
  })

  return res.data
}
